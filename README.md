# Gemini Search

[![npm version](https://img.shields.io/npm/v/docusaurus-plugin-gemini-search.svg)](https://www.npmjs.com/package/docusaurus-plugin-gemini-search)
[![license](https://img.shields.io/npm/l/docusaurus-plugin-gemini-search.svg)](./LICENSE)

API-first Gemini File Search for Docusaurus. Sync your docs, serve answers through a Fetch-compatible API handler, and bring your own UI.

## Setup

Install the package:

```bash
npm install docusaurus-plugin-gemini-search
```

Set your Gemini API key:

```env
GEMINI_API_KEY=your-api-key
```

Create a Gemini File Search store:

```bash
npx gemini-search create-store
```

Add the printed store name and your site URL to the `.env` file:

```env
GEMINI_FILE_SEARCH_STORE_NAME=fileSearchStores/...
GEMINI_SEARCH_SITE_URL=https://docs.example.com
```

Sync your docs:

```bash
npx gemini-search sync --dry-run
npx gemini-search sync
npx gemini-search sync --concurrency 6
```

Sync reads each document's `sourcePath` and `contentHash` metadata from the configured Gemini File Search store, skips active documents whose hashes already match, uploads changed documents, and removes stale remote copies. The local `.gemini-search` directory is only used for temporary upload files that are removed after upload.

Uploaded markdown includes a compact hidden context block with the document title, section, source path, URL, and frontmatter description when present.

## Quick Start

Create a Fetch handler in your server runtime:

```ts
import {createGeminiSearchFetchHandler} from 'docusaurus-plugin-gemini-search/fetch';

const handler = createGeminiSearchFetchHandler();

export async function POST(request: Request) {
  return handler(request);
}
```

Your UI calls that route with:

```json
{
  "question": "How do I install this?",
  "previousInteractionId": "optional-previous-interaction-id"
}
```

The response includes an `interactionId`. Store that value in your UI and send it as `previousInteractionId` on the next turn to continue the conversation with Gemini's server-side interaction history.

### Advanced: Core API

Use this when you want full control over routing, validation, auth, rate limiting, or response formatting.

```ts
import {createGeminiSearch} from 'docusaurus-plugin-gemini-search/core';

const geminiSearch = createGeminiSearch({
  prompt: 'Answer only from the retrieved documentation.',
});

const result = await geminiSearch.ask({
  question: 'How do I install this?',
  previousInteractionId: lastInteractionId,
});

console.log(result.answer, result.citations, result.interactionId);
```

## Deploy

### Vercel

Create `api/gemini-search.ts` with the Fetch handler from Quick Start. Set `GEMINI_API_KEY`, `GEMINI_FILE_SEARCH_STORE_NAME`, and `GEMINI_SEARCH_SITE_URL` in the Vercel dashboard.

Add a `vercel.json` if your project does not already configure Docusaurus output:

```json
{
  "buildCommand": "docusaurus build",
  "outputDirectory": "build"
}
```

### Cloudflare Workers

```ts
import {createGeminiSearchFetchHandler} from 'docusaurus-plugin-gemini-search/fetch';

const handler = createGeminiSearchFetchHandler();

export default {
  async fetch(request: Request) {
    if (new URL(request.url).pathname === '/api/gemini-search') {
      return handler(request);
    }

    return new Response('Not found', {status: 404});
  },
};
```

### Any Fetch-Compatible Server

`createGeminiSearchFetchHandler` works anywhere your server runtime accepts a Web Fetch `Request` and returns a `Response`, such as Hono, Next.js route handlers, Deno, or Bun.

> **Production note:** The API has no built-in rate limiting. Add rate limiting through your hosting provider, a WAF, or the `checkAccess` option before going public.

## Example

The `examples/docusaurus/` directory contains a working Docusaurus site with an API server and an Ask AI page.

```bash
git clone git@github.com:zxcv1884/docusaurus-plugin-gemini-search.git
cd docusaurus-plugin-gemini-search
npm install
npm run build

cd examples/docusaurus
npm install
cp .env.example .env.local
npm run api   # starts the API at http://127.0.0.1:3021/api/gemini-search
npm start     # in another terminal — opens http://127.0.0.1:3020/ask-ai
```

The package does not ship a UI component. If you want a starter page, copy `ask-ai.tsx` and `ask-ai.module.css` from the example into your own project and update `apiPath` to your deployed route.

## Options Reference

### Core Options

```ts
createGeminiSearch({
  // Optional overrides. By default, the core reads the required env vars above.
  apiKey: process.env.GEMINI_API_KEY,
  fileSearchStoreName: process.env.GEMINI_FILE_SEARCH_STORE_NAME,
  model: 'gemini-3.1-flash-lite',
  siteUrl: 'https://docs.example.com',
  prompt: 'Answer only from retrieved documentation.',
  transformAnswer(answer) {
    return answer;
  },
  filterCitation(citation) {
    return true;
  },
});
```

### Fetch Handler Options

The Fetch handler accepts every core option plus HTTP-layer options:

```ts
createGeminiSearchFetchHandler({
  allowedOrigins: ['https://docs.example.com'],
  async checkAccess({clientIp, question}) {
    return {allowed: true};
  },
  onError(error) {
    console.error(error);
  },
});
```

`checkAccess` is the intended hook for rate limits, Turnstile, auth, or tenant-specific controls.

### Sync CLI Options

```bash
npx gemini-search sync --dry-run
npx gemini-search sync --docs-dir docs --base-pathname /docs
npx gemini-search sync --source docs,/docs --source blog,/blog
npx gemini-search sync --concurrency 6
```

`--source` can be repeated and uses `<dir>,<basePathname>[,<section>]`. When `--source` is present, it takes precedence over `--docs-dir`.

Uploads run with concurrency 4 by default. Use `--concurrency <n>` or `GEMINI_SEARCH_SYNC_CONCURRENCY` to tune it; values are clamped from 1 to 8.

Use a different Gemini File Search store, or delete stale documents from the store, if you need to force a full re-upload.

### Docusaurus Plugin Options

By default, the plugin only registers its name and does not mount UI or API routes. Enable `syncOnBuild` if you want `docusaurus build` to sync docs after the build:

```ts
// docusaurus.config.ts
export default {
  plugins: [
    [
      'docusaurus-plugin-gemini-search',
      {
        syncOnBuild: true,
        docsDir: 'docs',
        basePathname: '/docs',
      },
    ],
  ],
};
```

### Package Entrypoints

```ts
import {createGeminiSearch} from 'docusaurus-plugin-gemini-search/core';
import {createGeminiSearchFetchHandler} from 'docusaurus-plugin-gemini-search/fetch';
import {syncGeminiSearch} from 'docusaurus-plugin-gemini-search/sync';
```

The default `docusaurus-plugin-gemini-search` export does not mount routes or ship UI. Use `/core`, `/fetch`, and `/sync` for the API-only integration surface.

## License

MIT
