import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getArgValue,
  getHelpText,
  parseArgs,
  parseSyncSources,
} from '../dist/cli.js';

test('parseArgs handles flags and key-value arguments', () => {
  const args = parseArgs([
    '--dry-run',
    '--docs-dir',
    'content',
    '--base-pathname',
    '/guides',
    '--store-name',
    'fileSearchStores/123',
  ]);

  assert.equal(args.flags.has('--dry-run'), true);
  assert.equal(getArgValue(args, '--docs-dir'), 'content');
  assert.equal(getArgValue(args, '--base-pathname'), '/guides');
  assert.equal(getArgValue(args, '--store-name'), 'fileSearchStores/123');
});

test('parseArgs keeps repeatable values', () => {
  const args = parseArgs([
    '--source',
    'docs,/docs',
    '--source',
    'blog,/blog,posts',
  ]);

  assert.deepEqual(args.values.get('--source'), ['docs,/docs', 'blog,/blog,posts']);
});

test('parseSyncSources parses repeatable source definitions', () => {
  assert.deepEqual(parseSyncSources(['docs,/docs', 'blog,/blog,posts']), [
    {dir: 'docs', basePathname: '/docs'},
    {dir: 'blog', basePathname: '/blog', section: 'posts'},
  ]);
});

test('parseSyncSources rejects malformed source definitions', () => {
  assert.throws(
    () => parseSyncSources(['docs']),
    /--source must use <dir>,<basePathname>\[,<section>\]\./,
  );
  assert.throws(
    () => parseSyncSources(['docs,/docs,docs,extra']),
    /--source must use <dir>,<basePathname>\[,<section>\]\./,
  );
});

test('help text documents source precedence and sync options', () => {
  const help = getHelpText();

  assert.match(help, /--docs-dir <path>/);
  assert.match(help, /--base-pathname <path>/);
  assert.match(help, /--source <dir>,<base>\[,<section>\]/);
  assert.match(help, /overrides --docs-dir/);
  assert.match(help, /--concurrency <n>/);
  assert.match(help, /gemini-search preview \[options\]/);
  assert.match(help, /--api-path <path>/);
  assert.match(help, /--site-dir <path>/);
  assert.match(help, /--allowed-origin <origin>/);
  assert.match(help, /--stream/);
});
