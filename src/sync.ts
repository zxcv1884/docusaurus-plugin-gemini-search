import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import {GoogleGenAI} from '@google/genai';

const CACHE_DIR = '.gemini-search';
const MANIFEST_FILENAME = 'manifest.json';

export type SyncOptions = {
  rootDir?: string;
  docsDir?: string;
  basePathname?: string;
  sources?: SyncSource[];
  siteUrl?: string;
  storeName?: string;
  apiKey?: string;
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
    uploadToFileSearchStore(input: unknown): Promise<unknown>;
  };
  operations: {
    get(input: unknown): Promise<unknown>;
  };
};

export type SyncManifest = {
  version: 1;
  documents: Record<string, {
    contentHash: string;
    url: string;
    title: string;
    section: string;
  }>;
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
  const manifestPath = getManifestPath(rootDir);
  const previousManifest = await readManifest(manifestPath);
  const changedDocs = docs.filter((doc) => previousManifest.documents[doc.sourcePath]?.contentHash !== doc.contentHash);
  const storeName = options.storeName || process.env.GEMINI_FILE_SEARCH_STORE_NAME || '';
  if (!options.dryRun && !apiKey) {
    throw new Error('GEMINI_API_KEY is required.');
  }
  if (!options.dryRun && !storeName.startsWith('fileSearchStores/')) {
    throw new Error('GEMINI_FILE_SEARCH_STORE_NAME must look like fileSearchStores/...');
  }

  if (options.dryRun) {
    const target = storeName || 'the configured Gemini File Search store';
    console.log(`Dry run: ${changedDocs.length} changed document(s) would be uploaded to ${target}.`);
    for (const doc of changedDocs.slice(0, 20)) {
      console.log(`${doc.sourcePath} -> ${doc.url}`);
    }
    if (changedDocs.length > 20) {
      console.log(`...and ${changedDocs.length - 20} more.`);
    }
    return;
  }

  const ai = options.client || new GoogleGenAI({apiKey});
  console.log(`Uploading ${changedDocs.length} changed document(s) to ${storeName}.`);
  for (const [index, doc] of changedDocs.entries()) {
    console.log(`[${index + 1}/${changedDocs.length}] ${doc.sourcePath}`);
    await uploadDocument(ai, rootDir, storeName, doc);
  }
  await writeManifest(manifestPath, createManifest(docs));
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
      const title = extractTitle(raw, absolutePath);
      const url = buildDocUrl(siteUrl, path.relative(source.absoluteDir, absolutePath), source.basePathname);
      const indexableContent = [
        `Title: ${title}`,
        `URL: ${url}`,
        `Source: ${sourcePath}`,
        '',
        stripFrontMatter(raw),
      ].join('\n');
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

function getManifestPath(rootDir: string) {
  return path.join(rootDir, CACHE_DIR, MANIFEST_FILENAME);
}

async function readManifest(manifestPath: string): Promise<SyncManifest> {
  try {
    const raw = await fs.readFile(manifestPath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<SyncManifest>;
    if (parsed.version === 1 && parsed.documents && typeof parsed.documents === 'object') {
      return {
        version: 1,
        documents: parsed.documents,
      };
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }

  return {version: 1, documents: {}};
}

function createManifest(docs: SyncDocument[]): SyncManifest {
  return {
    version: 1,
    documents: Object.fromEntries(docs.map((doc) => [
      doc.sourcePath,
      {
        contentHash: doc.contentHash,
        url: doc.url,
        title: doc.title,
        section: doc.section,
      },
    ])),
  };
}

async function writeManifest(manifestPath: string, manifest: SyncManifest) {
  await fs.mkdir(path.dirname(manifestPath), {recursive: true});
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

export function extractTitle(raw: string, absolutePath: string) {
  const frontMatterTitle = raw.match(/^---[\s\S]*?\ntitle:\s*["']?(.+?)["']?\n[\s\S]*?---/m)?.[1]?.trim();
  if (frontMatterTitle) {
    return frontMatterTitle;
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
