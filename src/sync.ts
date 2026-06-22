import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import {GoogleGenAI} from '@google/genai';

export type SyncOptions = {
  rootDir?: string;
  docsDir?: string;
  siteUrl?: string;
  storeName?: string;
  apiKey?: string;
  dryRun?: boolean;
  createStore?: boolean;
};

type SyncDocument = {
  absolutePath: string;
  sourcePath: string;
  title: string;
  url: string;
  section: string;
  contentHash: string;
  indexableContent: string;
};

export async function syncGeminiSearch(options: SyncOptions = {}) {
  const rootDir = options.rootDir || process.cwd();
  const docsDir = path.resolve(rootDir, options.docsDir || 'docs');
  const apiKey = options.apiKey || process.env.GEMINI_API_KEY || '';
  const siteUrl = (options.siteUrl || process.env.GEMINI_SEARCH_SITE_URL || '').replace(/\/$/, '');

  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is required.');
  }

  const ai = new GoogleGenAI({apiKey});

  if (options.createStore) {
    const store = await ai.fileSearchStores.create({
      config: {
        displayName: 'Docusaurus Gemini Search',
      },
    });
    console.log(`Created Gemini File Search store: ${store.name}`);
    return;
  }

  const storeName = options.storeName || process.env.GEMINI_FILE_SEARCH_STORE_NAME || '';
  if (!storeName.startsWith('fileSearchStores/')) {
    throw new Error('GEMINI_FILE_SEARCH_STORE_NAME must look like fileSearchStores/...');
  }

  const docs = await collectDocs(rootDir, docsDir, siteUrl);
  if (options.dryRun) {
    console.log(`Dry run: ${docs.length} document(s) would be uploaded to ${storeName}.`);
    for (const doc of docs.slice(0, 20)) {
      console.log(`${doc.sourcePath} -> ${doc.url}`);
    }
    if (docs.length > 20) {
      console.log(`...and ${docs.length - 20} more.`);
    }
    return;
  }

  console.log(`Uploading ${docs.length} document(s) to ${storeName}.`);
  for (const [index, doc] of docs.entries()) {
    console.log(`[${index + 1}/${docs.length}] ${doc.sourcePath}`);
    await uploadDocument(ai, storeName, doc);
  }
  console.log('Gemini Search sync complete.');
}

async function collectDocs(rootDir: string, docsDir: string, siteUrl: string): Promise<SyncDocument[]> {
  const files = await walkMarkdownFiles(docsDir);
  const docs: SyncDocument[] = [];

  for (const absolutePath of files) {
    const raw = await fs.readFile(absolutePath, 'utf8');
    const sourcePath = path.relative(rootDir, absolutePath).split(path.sep).join('/');
    const title = extractTitle(raw, absolutePath);
    const url = buildDocUrl(siteUrl, path.relative(docsDir, absolutePath));
    const section = sourcePath.split('/')[1] || 'docs';
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
      section,
      contentHash,
      indexableContent,
    });
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

async function uploadDocument(ai: GoogleGenAI, storeName: string, doc: SyncDocument) {
  const uploadPath = await writeUploadFile(doc);
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

async function writeUploadFile(doc: SyncDocument) {
  const cacheDir = path.join(process.cwd(), '.gemini-search');
  await fs.mkdir(cacheDir, {recursive: true});
  const filename = `${doc.contentHash}-${path.basename(doc.sourcePath).replace(/[^A-Za-z0-9._-]/g, '-')}`;
  const uploadPath = path.join(cacheDir, filename);
  await fs.writeFile(uploadPath, doc.indexableContent, 'utf8');
  return uploadPath;
}

async function waitForOperation(ai: GoogleGenAI, operation: any) {
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

function extractTitle(raw: string, absolutePath: string) {
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

function stripFrontMatter(raw: string) {
  return raw.replace(/^---[\s\S]*?---\s*/m, '').trim();
}

function buildDocUrl(siteUrl: string, relativePath: string) {
  const withoutExt = relativePath.replace(/\.(md|mdx)$/i, '');
  const withoutIndex = withoutExt.replace(/(^|\/)index$/i, '');
  const slug = withoutIndex
    .split(path.sep)
    .join('/')
    .replace(/^\/+|\/+$/g, '');
  const pathname = `/docs/${slug}`.replace(/\/$/, '');
  return siteUrl ? `${siteUrl}${pathname}` : pathname;
}
