import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import {GoogleGenAI} from '@google/genai';

const CACHE_DIR = '.gemini-search';
const DEFAULT_SYNC_CONCURRENCY = 4;
const MAX_SYNC_CONCURRENCY = 8;

export type SyncOptions = {
  rootDir?: string;
  docsDir?: string;
  basePathname?: string;
  sources?: SyncSource[];
  siteUrl?: string;
  storeName?: string;
  apiKey?: string;
  concurrency?: number;
  dryRun?: boolean;
  createStore?: boolean;
  client?: GeminiSyncClient;
};

export type SyncSource = {
  dir: string;
  basePathname?: string;
  section?: string;
};

export type ResolvedSyncSource = {
  dir: string;
  absoluteDir: string;
  basePathname: string;
  section: string;
};

export type SyncDocument = {
  absolutePath: string;
  sourcePath: string;
  title: string;
  url: string;
  section: string;
  contentHash: string;
  indexableContent: string;
};

export type GeminiSyncClient = {
  fileSearchStores: {
    create(input: unknown): Promise<{name?: string}>;
    documents: {
      list(input: unknown): AsyncIterable<GeminiStoreDocument> | Promise<AsyncIterable<GeminiStoreDocument> | GeminiStoreDocument[]>;
      delete(input: unknown): Promise<unknown>;
    };
    uploadToFileSearchStore(input: unknown): Promise<unknown>;
  };
  operations: {
    get(input: unknown): Promise<unknown>;
  };
};

export type GeminiStoreDocument = {
  name?: string;
  displayName?: string;
  state?: string;
  customMetadata?: GeminiMetadataEntry[];
  custom_metadata?: GeminiMetadataEntry[];
};

export type GeminiMetadataEntry = {
  key?: string;
  stringValue?: string;
  string_value?: string;
};

type ListedStoreDocument = GeminiStoreDocument & {
  name: string;
  sourcePath: string;
  contentHash: string;
};

type PlannedDelete = {
  name: string;
  sourcePath: string;
  reason: 'changed-hash' | 'duplicate' | 'failed' | 'removed-local-doc' | 'stale-hash';
};

type IncrementalSyncPlan = {
  existingDocumentsCount: number;
  missingMetadata: GeminiStoreDocument[];
  skipped: SyncDocument[];
  toDelete: PlannedDelete[];
  toUpload: SyncDocument[];
};

export async function syncGeminiSearch(options: SyncOptions = {}) {
  const rootDir = options.rootDir || process.cwd();
  const apiKey = options.apiKey || process.env.GEMINI_API_KEY || '';
  const siteUrl = (options.siteUrl || process.env.GEMINI_SEARCH_SITE_URL || '').replace(/\/$/, '');

  if (options.createStore) {
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is required.');
    }

    const ai = options.client || new GoogleGenAI({apiKey});
    const store = await ai.fileSearchStores.create({
      config: {
        displayName: 'Docusaurus Gemini Search',
      },
    });
    console.log(`Created Gemini File Search store: ${store.name}`);
    return;
  }

  const sources = resolveSyncSources(rootDir, options);
  const docs = await collectDocs(rootDir, sources, siteUrl);
  const storeName = options.storeName || process.env.GEMINI_FILE_SEARCH_STORE_NAME || '';
  if (!apiKey && !options.client) {
    throw new Error('GEMINI_API_KEY is required.');
  }
  if (!storeName.startsWith('fileSearchStores/')) {
    throw new Error('GEMINI_FILE_SEARCH_STORE_NAME must look like fileSearchStores/...');
  }

  const ai = options.client || new GoogleGenAI({apiKey});
  const syncPlan = await buildIncrementalSyncPlan(ai, rootDir, storeName, docs, sources);
  printIncrementalSyncPlan(syncPlan);

  if (options.dryRun) {
    console.log(`Dry run: ${syncPlan.toUpload.length} changed document(s) would be uploaded to ${storeName}.`);
    for (const doc of syncPlan.toUpload.slice(0, 20)) {
      console.log(`${doc.sourcePath} -> ${doc.url}`);
    }
    if (syncPlan.toUpload.length > 20) {
      console.log(`...and ${syncPlan.toUpload.length - 20} more.`);
    }
    if (syncPlan.toDelete.length) {
      console.log(`Dry run: ${syncPlan.toDelete.length} stale document(s) would be deleted.`);
    }
    return;
  }

  await uploadDocuments(ai, rootDir, storeName, syncPlan.toUpload, resolveSyncConcurrency(options.concurrency));

  await deletePlannedDocuments(ai, syncPlan.toDelete);
  console.log('Gemini Search sync complete.');
}

export function resolveSyncSources(rootDir: string, options: Pick<SyncOptions, 'docsDir' | 'basePathname' | 'sources'>): ResolvedSyncSource[] {
  const configuredSources = options.sources?.length
    ? options.sources
    : [
      {
        dir: options.docsDir || 'docs',
        basePathname: options.basePathname || '/docs',
      },
    ];

  return configuredSources.map((source) => {
    const dir = source.dir || 'docs';
    return {
      dir,
      absoluteDir: path.resolve(rootDir, dir),
      basePathname: source.basePathname || '/docs',
      section: source.section || inferSection(dir),
    };
  });
}

export async function collectDocs(rootDir: string, sources: ResolvedSyncSource[], siteUrl: string): Promise<SyncDocument[]> {
  const docs: SyncDocument[] = [];

  for (const source of sources) {
    const files = await walkMarkdownFiles(source.absoluteDir);

    for (const absolutePath of files) {
      const raw = await fs.readFile(absolutePath, 'utf8');
      const sourcePath = path.relative(rootDir, absolutePath).split(path.sep).join('/');
      const frontMatter = parseFrontMatter(raw);
      const title = extractTitle(raw, absolutePath, frontMatter);
      const url = buildDocUrl(siteUrl, path.relative(source.absoluteDir, absolutePath), source.basePathname);
      const indexableContent = buildIndexableMarkdown({
        content: stripFrontMatter(raw),
        description: frontMatter.description,
        section: source.section,
        sourcePath,
        title,
        url,
      });
      const contentHash = createHash('sha256').update(indexableContent).digest('hex').slice(0, 16);

      docs.push({
        absolutePath,
        sourcePath,
        title,
        url,
        section: source.section,
        contentHash,
        indexableContent,
      });
    }
  }

  return docs.sort((a, b) => a.sourcePath.localeCompare(b.sourcePath));
}

async function walkMarkdownFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, {withFileTypes: true});
  const files: string[] = [];

  for (const entry of entries) {
    const absolutePath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walkMarkdownFiles(absolutePath));
    } else if (/\.(md|mdx)$/i.test(entry.name)) {
      files.push(absolutePath);
    }
  }

  return files;
}

async function uploadDocument(ai: GeminiSyncClient, rootDir: string, storeName: string, doc: SyncDocument) {
  const uploadPath = await writeUploadFile(rootDir, doc);
  const operation = await ai.fileSearchStores.uploadToFileSearchStore({
    fileSearchStoreName: storeName,
    file: uploadPath,
    config: {
      mimeType: 'text/markdown',
      displayName: doc.title,
      customMetadata: [
        {key: 'sourcePath', stringValue: doc.sourcePath},
        {key: 'url', stringValue: doc.url},
        {key: 'title', stringValue: doc.title},
        {key: 'displayName', stringValue: doc.title},
        {key: 'section', stringValue: doc.section},
        {key: 'contentHash', stringValue: doc.contentHash},
      ],
    },
  });
  await waitForOperation(ai, operation);
}

async function uploadDocuments(
  ai: GeminiSyncClient,
  rootDir: string,
  storeName: string,
  docs: SyncDocument[],
  concurrency: number,
) {
  if (!docs.length) {
    console.log(`Uploading 0 changed document(s) to ${storeName}.`);
    return;
  }

  const workerCount = Math.min(concurrency, docs.length);
  const failures: Array<{doc: SyncDocument; error: unknown}> = [];
  let nextIndex = 0;

  console.log(`Uploading ${docs.length} changed document(s) to ${storeName} with concurrency ${workerCount}.`);

  async function worker() {
    while (nextIndex < docs.length) {
      const index = nextIndex;
      nextIndex += 1;
      const doc = docs[index];

      try {
        console.log(`[${index + 1}/${docs.length}] ${doc.sourcePath}`);
        await uploadDocument(ai, rootDir, storeName, doc);
      } catch (error) {
        failures.push({doc, error});
        console.error(`[${index + 1}/${docs.length}] Failed ${doc.sourcePath}: ${formatErrorMessage(error)}`);
      }
    }
  }

  await Promise.all(Array.from({length: workerCount}, () => worker()));

  if (failures.length) {
    throw new Error(`Failed to upload ${failures.length} document(s): ${failures.map((failure) => failure.doc.sourcePath).join(', ')}`);
  }
}

function resolveSyncConcurrency(value: number | undefined) {
  const envValue = Number(process.env.GEMINI_SEARCH_SYNC_CONCURRENCY);
  const parsed = Number.isFinite(value) && value ? value : envValue;
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_SYNC_CONCURRENCY;
  }

  return Math.max(1, Math.min(Math.floor(parsed), MAX_SYNC_CONCURRENCY));
}

function formatErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function buildIncrementalSyncPlan(
  ai: GeminiSyncClient,
  rootDir: string,
  storeName: string,
  docs: SyncDocument[],
  sources: ResolvedSyncSource[],
): Promise<IncrementalSyncPlan> {
  const existingDocuments = await listStoreDocuments(ai, storeName);
  const docsBySourcePath = new Map(docs.map((doc) => [doc.sourcePath, doc]));
  const syncedSourceDirs = sources.map((source) => (
    path.relative(rootDir, source.absoluteDir).split(path.sep).join('/').replace(/^\/+|\/+$/g, '')
  ));
  const existingBySourcePath = new Map<string, ListedStoreDocument[]>();
  const toDelete: PlannedDelete[] = [];
  const toUpload: SyncDocument[] = [];
  const skipped: SyncDocument[] = [];
  const missingMetadata: GeminiStoreDocument[] = [];

  for (const document of existingDocuments) {
    if (!document.sourcePath) {
      missingMetadata.push(document);
      continue;
    }

    const group = existingBySourcePath.get(document.sourcePath) || [];
    group.push(document);
    existingBySourcePath.set(document.sourcePath, group);
  }

  for (const [sourcePath, doc] of docsBySourcePath.entries()) {
    const existing = existingBySourcePath.get(sourcePath) || [];
    const activeSameHash = existing.find((document) => (
      document.state === 'STATE_ACTIVE' && document.contentHash === doc.contentHash
    ));

    if (activeSameHash) {
      skipped.push(doc);
      for (const duplicate of existing) {
        if (duplicate.name === activeSameHash.name) {
          continue;
        }

        toDelete.push({
          name: duplicate.name,
          sourcePath,
          reason: duplicate.contentHash === doc.contentHash ? 'duplicate' : 'stale-hash',
        });
      }
      continue;
    }

    for (const document of existing) {
      toDelete.push({
        name: document.name,
        sourcePath,
        reason: document.state === 'STATE_FAILED' ? 'failed' : 'changed-hash',
      });
    }
    toUpload.push(doc);
  }

  for (const document of existingDocuments) {
    if (
      document.sourcePath
      && !docsBySourcePath.has(document.sourcePath)
      && isWithinSyncedSources(document.sourcePath, syncedSourceDirs)
    ) {
      toDelete.push({
        name: document.name,
        sourcePath: document.sourcePath,
        reason: 'removed-local-doc',
      });
    }
  }

  return {
    existingDocumentsCount: existingDocuments.length,
    missingMetadata,
    skipped,
    toDelete: dedupeDeletes(toDelete),
    toUpload,
  };
}

function isWithinSyncedSources(sourcePath: string, syncedSourceDirs: string[]) {
  return syncedSourceDirs.some((dir) => !dir || sourcePath === dir || sourcePath.startsWith(`${dir}/`));
}

async function listStoreDocuments(ai: GeminiSyncClient, storeName: string): Promise<ListedStoreDocument[]> {
  const listed = await ai.fileSearchStores.documents.list({
    parent: storeName,
    config: {pageSize: 20},
  });
  const result: ListedStoreDocument[] = [];

  if (isAsyncIterable<GeminiStoreDocument>(listed)) {
    for await (const document of listed) {
      const normalized = normalizeStoreDocument(document);
      if (normalized.name) {
        result.push(normalized as ListedStoreDocument);
      }
    }
    return result;
  }

  for (const document of listed) {
    const normalized = normalizeStoreDocument(document);
    if (normalized.name) {
      result.push(normalized as ListedStoreDocument);
    }
  }

  return result;
}

function normalizeStoreDocument(document: GeminiStoreDocument): GeminiStoreDocument & {
  sourcePath: string;
  contentHash: string;
} {
  const metadata = document.customMetadata || document.custom_metadata || [];
  return {
    ...document,
    sourcePath: getMetadataValue(metadata, 'sourcePath'),
    contentHash: getMetadataValue(metadata, 'contentHash'),
  };
}

function getMetadataValue(metadata: GeminiMetadataEntry[], key: string) {
  const item = metadata.find((entry) => entry.key === key);
  return item?.stringValue || item?.string_value || '';
}

function isAsyncIterable<T>(value: unknown): value is AsyncIterable<T> {
  return Boolean(value && typeof (value as AsyncIterable<T>)[Symbol.asyncIterator] === 'function');
}

function dedupeDeletes(toDelete: PlannedDelete[]) {
  const seen = new Set<string>();
  const result: PlannedDelete[] = [];

  for (const item of toDelete) {
    if (seen.has(item.name)) {
      continue;
    }
    seen.add(item.name);
    result.push(item);
  }

  return result;
}

function printIncrementalSyncPlan(syncPlan: IncrementalSyncPlan) {
  console.log(JSON.stringify({
    mode: 'incremental',
    existingDocumentsCount: syncPlan.existingDocumentsCount,
    skippedUnchangedCount: syncPlan.skipped.length,
    uploadCount: syncPlan.toUpload.length,
    deleteCount: syncPlan.toDelete.length,
    deleteReasons: countBy(syncPlan.toDelete, (item) => item.reason),
    missingMetadataCount: syncPlan.missingMetadata.length,
  }, null, 2));

  if (syncPlan.missingMetadata.length) {
    console.log('Documents without sourcePath metadata are left untouched:');
    for (const document of syncPlan.missingMetadata) {
      console.log(`- ${document.name || 'unknown'} (${document.displayName || 'untitled'})`);
    }
  }
}

function countBy<T>(items: T[], getKey: (item: T) => string) {
  return items.reduce<Record<string, number>>((counts, item) => {
    const key = getKey(item);
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

async function deletePlannedDocuments(ai: GeminiSyncClient, toDelete: PlannedDelete[]) {
  if (!toDelete.length) {
    return;
  }

  console.log(`Deleting ${toDelete.length} stale Gemini File Search document(s).`);
  for (const item of toDelete) {
    console.log(`Deleting ${item.sourcePath} (${item.reason})`);
    await ai.fileSearchStores.documents.delete({name: item.name, config: {force: true}});
  }
}

async function writeUploadFile(rootDir: string, doc: SyncDocument) {
  const cacheDir = path.join(rootDir, CACHE_DIR);
  await fs.mkdir(cacheDir, {recursive: true});
  const filename = `${doc.contentHash}-${path.basename(doc.sourcePath).replace(/[^A-Za-z0-9._-]/g, '-')}`;
  const uploadPath = path.join(cacheDir, filename);
  await fs.writeFile(uploadPath, doc.indexableContent, 'utf8');
  return uploadPath;
}

async function waitForOperation(ai: GeminiSyncClient, operation: any) {
  let current = operation;
  const startedAt = Date.now();
  const timeoutMs = 180_000;

  while (!current.done) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`Timed out waiting for Gemini operation ${operation?.name || ''}`);
    }

    await new Promise((resolve) => setTimeout(resolve, 5000));
    current = await ai.operations.get({operation: current});
  }

  if (current.error) {
    throw new Error(`Gemini operation failed: ${JSON.stringify(current.error)}`);
  }
}

function buildIndexableMarkdown({
  content,
  description,
  section,
  sourcePath,
  title,
  url,
}: {
  content: string;
  description?: string;
  section: string;
  sourcePath: string;
  title: string;
  url: string;
}) {
  const contextLines = [
    '<!-- GEMINI_SEARCH_CONTEXT_START',
    `Title: ${title}`,
    `Section: ${section}`,
    `Source path: ${sourcePath}`,
    `URL: ${url}`,
    description ? `Description: ${description}` : '',
    'GEMINI_SEARCH_CONTEXT_END -->',
  ].filter((line) => line !== '');

  return `${contextLines.join('\n')}\n\n${content}`;
}

export function extractTitle(raw: string, absolutePath: string, frontMatter = parseFrontMatter(raw)) {
  if (frontMatter.title) {
    return frontMatter.title;
  }

  const heading = raw.match(/^#\s+(.+)$/m)?.[1]?.trim();
  if (heading) {
    return heading;
  }

  return path.basename(absolutePath).replace(/\.(md|mdx)$/i, '').replace(/[-_]+/g, ' ');
}

export function stripFrontMatter(raw: string) {
  return raw.replace(/^---[\s\S]*?---\s*/m, '').trim();
}

function parseFrontMatter(raw: string): Record<string, string> {
  if (!raw.startsWith('---')) {
    return {};
  }

  const end = raw.indexOf('\n---', 3);
  if (end === -1) {
    return {};
  }

  const frontMatter = raw.slice(3, end).trim();
  const result: Record<string, string> = {};

  for (const line of frontMatter.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.+)$/);
    if (match) {
      result[match[1]] = match[2].replace(/^["']|["']$/g, '').trim();
    }
  }

  return result;
}

export function buildDocUrl(siteUrl: string, relativePath: string, basePathname = '/docs') {
  const withoutExt = relativePath.replace(/\.(md|mdx)$/i, '');
  const withoutIndex = withoutExt.replace(/(^|\/)index$/i, '');
  const slug = withoutIndex
    .split(path.sep)
    .join('/')
    .replace(/^\/+|\/+$/g, '');
  const base = normalizeBasePathname(basePathname);
  const pathname = slug ? `${base === '/' ? '' : base}/${slug}` : base;
  return siteUrl ? `${siteUrl.replace(/\/$/, '')}${pathname}` : pathname;
}

function inferSection(dir: string) {
  return dir.split(/[\\/]/).filter(Boolean)[0] || 'docs';
}

function normalizeBasePathname(value: string) {
  const trimmed = value.trim();
  if (!trimmed || trimmed === '/') {
    return '/';
  }

  return `/${trimmed.replace(/^\/+|\/+$/g, '')}`;
}
