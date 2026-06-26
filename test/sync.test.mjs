import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  buildDocUrl,
  collectDocs,
  resolveSyncSources,
  syncGeminiSearch,
} from '../dist/sync.js';

test('buildDocUrl uses /docs by default', () => {
  assert.equal(buildDocUrl('', 'intro.md'), '/docs/intro');
  assert.equal(buildDocUrl('', 'guides/index.md'), '/docs/guides');
});

test('buildDocUrl supports root and custom base pathnames', () => {
  assert.equal(buildDocUrl('', 'index.md', '/'), '/');
  assert.equal(buildDocUrl('', 'intro.md', '/'), '/intro');
  assert.equal(buildDocUrl('', 'intro.md', '/guides/'), '/guides/intro');
  assert.equal(buildDocUrl('https://docs.example.com', 'intro.md', '/guides'), 'https://docs.example.com/guides/intro');
  assert.equal(buildDocUrl('https://docs.example.com/', 'intro.md', '/guides'), 'https://docs.example.com/guides/intro');
});

test('buildDocUrl prefers Docusaurus frontmatter slug when present', () => {
  assert.equal(
    buildDocUrl('', 'nested/overview.md', '/docs', '/embedded-vision/vizioncam-usb3/usb-camera-troubleshooting'),
    '/docs/embedded-vision/vizioncam-usb3/usb-camera-troubleshooting',
  );
  assert.equal(buildDocUrl('https://docs.example.com', 'nested/overview.md', '/docs', 'custom-page'), 'https://docs.example.com/docs/custom-page');
});

test('resolveSyncSources uses docsDir shorthand by default', () => {
  const rootDir = path.join(os.tmpdir(), 'gemini-search-root');
  const [source] = resolveSyncSources(rootDir, {docsDir: 'content', basePathname: '/guides'});

  assert.deepEqual(source, {
    dir: 'content',
    absoluteDir: path.resolve(rootDir, 'content'),
    basePathname: '/guides',
    section: 'content',
  });
});

test('resolveSyncSources lets sources override docsDir', () => {
  const rootDir = path.join(os.tmpdir(), 'gemini-search-root');
  const sources = resolveSyncSources(rootDir, {
    docsDir: 'ignored',
    basePathname: '/ignored',
    sources: [
      {dir: 'docs', basePathname: '/docs'},
      {dir: 'blog', basePathname: '/blog', section: 'posts'},
    ],
  });

  assert.equal(sources.length, 2);
  assert.equal(sources[0].dir, 'docs');
  assert.equal(sources[0].basePathname, '/docs');
  assert.equal(sources[0].section, 'docs');
  assert.equal(sources[1].dir, 'blog');
  assert.equal(sources[1].basePathname, '/blog');
  assert.equal(sources[1].section, 'posts');
});

test('collectDocs combines multiple sources with per-source URLs and sections', async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gemini-search-sync-'));
  await fs.mkdir(path.join(rootDir, 'docs'), {recursive: true});
  await fs.mkdir(path.join(rootDir, 'blog'), {recursive: true});
  await fs.writeFile(path.join(rootDir, 'docs', 'index.md'), '---\ntitle: Docs Home\ndescription: Start here\n---\n# Ignored\nWelcome', 'utf8');
  await fs.mkdir(path.join(rootDir, 'docs', 'nested'), {recursive: true});
  await fs.writeFile(path.join(rootDir, 'docs', 'nested', 'overview.md'), '---\ntitle: Nested Overview\nslug: /custom-overview\n---\n# Ignored\nCustom', 'utf8');
  await fs.writeFile(path.join(rootDir, 'blog', 'first-post.md'), '# First Post\nHello', 'utf8');

  const sources = resolveSyncSources(rootDir, {
    sources: [
      {dir: 'docs', basePathname: '/'},
      {dir: 'blog', basePathname: '/blog', section: 'posts'},
    ],
  });
  const docs = await collectDocs(rootDir, sources, 'https://docs.example.com');

  assert.equal(docs.length, 3);
  assert.deepEqual(
    docs.map((doc) => ({sourcePath: doc.sourcePath, title: doc.title, url: doc.url, section: doc.section})),
    [
      {
        sourcePath: 'blog/first-post.md',
        title: 'First Post',
        url: 'https://docs.example.com/blog/first-post',
        section: 'posts',
      },
      {
        sourcePath: 'docs/index.md',
        title: 'Docs Home',
        url: 'https://docs.example.com/',
        section: 'docs',
      },
      {
        sourcePath: 'docs/nested/overview.md',
        title: 'Nested Overview',
        url: 'https://docs.example.com/custom-overview',
        section: 'docs',
      },
    ],
  );
  const docsHome = docs.find((doc) => doc.sourcePath === 'docs/index.md');
  assert.match(docsHome.indexableContent, /^<!-- GEMINI_SEARCH_CONTEXT_START\nTitle: Docs Home\nSection: docs\nSource path: docs\/index\.md\nURL: https:\/\/docs\.example\.com\/\nDescription: Start here\nGEMINI_SEARCH_CONTEXT_END -->\n\n# Ignored\nWelcome$/);
  assert.doesNotMatch(docsHome.indexableContent, /---/);
});

test('syncGeminiSearch skips unchanged documents using store metadata', async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gemini-search-sync-'));
  const docsDir = path.join(rootDir, 'docs');
  await fs.mkdir(docsDir, {recursive: true});
  await fs.writeFile(path.join(docsDir, 'intro.md'), '# Intro\nHello', 'utf8');
  await fs.writeFile(path.join(docsDir, 'setup.md'), '# Setup\nInstall', 'utf8');

  const uploads = [];
  const deletes = [];
  const storeDocuments = [{
    name: 'fileSearchStores/docs/documents/blog',
    state: 'STATE_ACTIVE',
    customMetadata: [
      {key: 'sourcePath', stringValue: 'blog/old-post.md'},
      {key: 'contentHash', stringValue: 'old-hash'},
    ],
  }];
  let nextDocumentId = 1;
  const client = {
    fileSearchStores: {
      async create() {
        return {name: 'fileSearchStores/docs'};
      },
      documents: {
        async list() {
          return storeDocuments;
        },
        async delete(input) {
          const index = storeDocuments.findIndex((document) => document.name === input.name);
          if (index !== -1) {
            deletes.push({
              ...input,
              sourcePath: storeDocuments[index].customMetadata.find((item) => item.key === 'sourcePath')?.stringValue,
            });
            storeDocuments.splice(index, 1);
          }
        },
      },
      async uploadToFileSearchStore(input) {
        uploads.push(input);
        storeDocuments.push({
          name: `fileSearchStores/docs/documents/${nextDocumentId++}`,
          state: 'STATE_ACTIVE',
          customMetadata: input.config.customMetadata,
        });
        return {done: true};
      },
    },
    operations: {
      async get() {
        return {done: true};
      },
    },
  };

  const options = {
    rootDir,
    apiKey: 'test-key',
    storeName: 'fileSearchStores/docs',
    siteUrl: 'https://docs.example.com',
    client,
  };

  await syncGeminiSearch(options);
  assert.equal(uploads.length, 2);
  assert.deepEqual(await fs.readdir(path.join(rootDir, '.gemini-search')), []);

  await syncGeminiSearch(options);
  assert.equal(uploads.length, 2);

  await fs.writeFile(path.join(docsDir, 'setup.md'), '# Setup\nInstall with npm', 'utf8');
  await syncGeminiSearch(options);
  assert.equal(uploads.length, 3);
  assert.equal(uploads.at(-1).config.customMetadata.find((item) => item.key === 'sourcePath').stringValue, 'docs/setup.md');
  assert.equal(deletes.length, 1);
  assert.equal(deletes[0].sourcePath, 'docs/setup.md');

  await fs.rm(path.join(docsDir, 'intro.md'));
  await syncGeminiSearch(options);
  assert.equal(deletes.length, 2);
  assert.equal(deletes[1].sourcePath, 'docs/intro.md');
  assert.equal(storeDocuments.some((document) => document.name === 'fileSearchStores/docs/documents/blog'), true);
});

test('syncGeminiSearch uploads changed documents concurrently', async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gemini-search-sync-'));
  const docsDir = path.join(rootDir, 'docs');
  await fs.mkdir(docsDir, {recursive: true});
  await fs.writeFile(path.join(docsDir, 'a.md'), '# A\nAlpha', 'utf8');
  await fs.writeFile(path.join(docsDir, 'b.md'), '# B\nBeta', 'utf8');
  await fs.writeFile(path.join(docsDir, 'c.md'), '# C\nGamma', 'utf8');

  let activeUploads = 0;
  let maxActiveUploads = 0;
  const client = {
    fileSearchStores: {
      async create() {
        return {name: 'fileSearchStores/docs'};
      },
      documents: {
        async list() {
          return [];
        },
        async delete() {},
      },
      async uploadToFileSearchStore() {
        activeUploads += 1;
        maxActiveUploads = Math.max(maxActiveUploads, activeUploads);
        await new Promise((resolve) => setTimeout(resolve, 10));
        activeUploads -= 1;
        return {done: true};
      },
    },
    operations: {
      async get() {
        return {done: true};
      },
    },
  };

  await syncGeminiSearch({
    rootDir,
    apiKey: 'test-key',
    storeName: 'fileSearchStores/docs',
    siteUrl: 'https://docs.example.com',
    concurrency: 2,
    client,
  });

  assert.equal(maxActiveUploads, 2);
});
