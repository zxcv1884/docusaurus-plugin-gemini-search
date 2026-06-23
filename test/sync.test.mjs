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
  await fs.writeFile(path.join(rootDir, 'docs', 'index.md'), '---\ntitle: Docs Home\n---\n# Ignored\nWelcome', 'utf8');
  await fs.writeFile(path.join(rootDir, 'blog', 'first-post.md'), '# First Post\nHello', 'utf8');

  const sources = resolveSyncSources(rootDir, {
    sources: [
      {dir: 'docs', basePathname: '/'},
      {dir: 'blog', basePathname: '/blog', section: 'posts'},
    ],
  });
  const docs = await collectDocs(rootDir, sources, 'https://docs.example.com');

  assert.equal(docs.length, 2);
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
    ],
  );
});

test('syncGeminiSearch skips unchanged documents using the manifest', async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gemini-search-sync-'));
  const docsDir = path.join(rootDir, 'docs');
  await fs.mkdir(docsDir, {recursive: true});
  await fs.writeFile(path.join(docsDir, 'intro.md'), '# Intro\nHello', 'utf8');
  await fs.writeFile(path.join(docsDir, 'setup.md'), '# Setup\nInstall', 'utf8');

  const uploads = [];
  const client = {
    fileSearchStores: {
      async create() {
        return {name: 'fileSearchStores/docs'};
      },
      async uploadToFileSearchStore(input) {
        uploads.push(input);
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

  await syncGeminiSearch(options);
  assert.equal(uploads.length, 2);

  await fs.writeFile(path.join(docsDir, 'setup.md'), '# Setup\nInstall with npm', 'utf8');
  await syncGeminiSearch(options);
  assert.equal(uploads.length, 3);
  assert.equal(uploads.at(-1).config.customMetadata.find((item) => item.key === 'sourcePath').stringValue, 'docs/setup.md');

  const manifest = JSON.parse(await fs.readFile(path.join(rootDir, '.gemini-search', 'manifest.json'), 'utf8'));
  assert.equal(manifest.version, 1);
  assert.deepEqual(Object.keys(manifest.documents).sort(), ['docs/intro.md', 'docs/setup.md']);
});
