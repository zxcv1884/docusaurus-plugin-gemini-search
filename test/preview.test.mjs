import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {loadEnvFiles, startGeminiSearchPreview} from '../dist/preview.js';

test('loadEnvFiles loads .env and lets .env.local override it', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-search-env-'));
  const envKey = `GEMINI_SEARCH_TEST_${Date.now()}`;

  fs.writeFileSync(path.join(cwd, '.env'), `${envKey}=from-env\n`);
  fs.writeFileSync(path.join(cwd, '.env.local'), `${envKey}=from-local\n`);

  try {
    const loaded = loadEnvFiles(cwd);

    assert.deepEqual(loaded, ['.env', '.env.local']);
    assert.equal(process.env[envKey], 'from-local');
  } finally {
    delete process.env[envKey];
    fs.rmSync(cwd, {recursive: true, force: true});
  }
});

test('loadEnvFiles keeps environment variables that were set before loading files', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-search-env-'));
  const envKey = `GEMINI_SEARCH_EXISTING_${Date.now()}`;
  process.env[envKey] = 'from-process';

  fs.writeFileSync(path.join(cwd, '.env.local'), `${envKey}=from-local\n`);

  try {
    loadEnvFiles(cwd);

    assert.equal(process.env[envKey], 'from-process');
  } finally {
    delete process.env[envKey];
    fs.rmSync(cwd, {recursive: true, force: true});
  }
});

test('preview serves a Docusaurus build and mounts the API route', async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-search-preview-'));
  const buildDir = path.join(cwd, 'build');
  fs.mkdirSync(path.join(buildDir, 'docs', 'setup'), {recursive: true});
  fs.writeFileSync(path.join(buildDir, 'index.html'), '<h1>Home</h1>');
  fs.writeFileSync(path.join(buildDir, 'docs', 'setup', 'index.html'), '<h1>Setup</h1>');

  const preview = await startGeminiSearchPreview({
    cwd,
    siteDir: 'build',
    port: 0,
    envFiles: [],
    log() {},
  });

  try {
    const home = await fetch(`${preview.url}/`);
    assert.equal(home.status, 200);
    assert.equal(home.headers.get('content-type'), 'text/html; charset=utf-8');
    assert.equal(await home.text(), '<h1>Home</h1>');

    const nested = await fetch(`${preview.url}/docs/setup`);
    assert.equal(nested.status, 200);
    assert.equal(await nested.text(), '<h1>Setup</h1>');

    const api = await fetch(`${preview.url}/api/gemini-search`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: '{}',
    });
    assert.equal(api.status, 400);
    assert.deepEqual(await api.json(), {error: 'Question is required'});
  } finally {
    await new Promise((resolve) => preview.server.close(resolve));
    fs.rmSync(cwd, {recursive: true, force: true});
  }
});
