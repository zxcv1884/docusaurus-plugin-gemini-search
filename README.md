# Gemini Search

[![npm version](https://img.shields.io/npm/v/docusaurus-plugin-gemini-search.svg)](https://www.npmjs.com/package/docusaurus-plugin-gemini-search)
[![license](https://img.shields.io/npm/l/docusaurus-plugin-gemini-search.svg)](./LICENSE)

API-first Gemini File Search for Docusaurus. Sync your docs, serve answers through a Fetch-compatible API handler, and bring your own UI.

This package does not publish a production API route for you. In production, create your own server-side route, serverless function, or worker that imports `/fetch` or `/core`; keep `GEMINI_API_KEY` on that server-side runtime.

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

Preview a built Docusaurus site locally:

```bash
npm run build
npx gemini-search preview --api-path /api/gemini-search --site-dir build --port 3021 --stream
```

The preview server serves the static Docusaurus `build/` directory, mounts the Gemini Search Fetch handler at the configured API path, loads `.env` and `.env.local`, and prints the local URL. Pass `--stream` to test Server-Sent Events locally. It does not sync docs, create stores, or change remote Gemini File Search data.

## Quick Start

Create a Fetch handler in your server runtime. This route is required in production because the Docusaurus plugin export does not mount an API endpoint automatically:

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

To stream successful answers as Server-Sent Events, opt in on the server:

```ts
const handler = createGeminiSearchFetchHandler({
  stream: true,
});
```

Streamed responses emit incremental `delta` events followed by one `done` event:

```text
event: delta
data: {"type":"delta","text":"Partial answer"}

event: done
data: {"type":"done","answer":"Full answer","citations":[],"interactionId":"..."}
```

Validation and access-denied responses still use normal JSON error responses.

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

for await (const event of geminiSearch.stream({question: 'How do I install this?'})) {
  if (event.type === 'delta') {
    process.stdout.write(event.text);
  }
  if (event.type === 'done') {
    console.log(event.citations, event.interactionId);
  }
}
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
npm run build
npm run preview   # opens http://127.0.0.1:3021/ask-ai with the API mounted
```

The package does not ship a UI component. If you want a starter page, copy `ask-ai.tsx` and `ask-ai.module.css` from the example into your own project and keep your API route mounted at `/api/gemini-search`, or update `apiPath` to your deployed route.

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
  stream: true,
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

### Preview CLI Options

```bash
npx gemini-search preview
npx gemini-search preview --api-path /api/gemini-search --site-dir build --port 3021
npx gemini-search preview --api-path /api/gemini-search --site-dir build --stream
npx gemini-search preview --allowed-origin http://127.0.0.1:3020
```

`preview` is a local development helper. It serves static files from `--site-dir`, mounts the package Fetch handler at `--api-path`, and reads `.env` followed by `.env.local` from the current working directory. `.env.local` values override matching `.env` values, while environment variables already set in the shell are preserved. Add `--stream` when you want the preview API to return `text/event-stream` responses.

The preview helper mounts its own package Fetch handler; it does not load a project-specific route file such as `api/gemini-search.ts`. Use the Fetch handler options in your production route, and use preview CLI flags such as `--stream` for local preview behavior.

It intentionally does not replace a production API wrapper. Keep project-specific concerns such as rate limiting, Turnstile, origin policy, tenant checks, Redis persistence, or custom citation cleanup in your own server route, usually by wrapping `/fetch` or `/core`.

### Docusaurus Plugin Options

By default, the Docusaurus plugin only registers its name and does not mount UI or API routes. Create a server route with `/fetch` or `/core` for production Ask AI traffic. Enable `syncOnBuild` if you want `docusaurus build` to sync docs after the build:

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
