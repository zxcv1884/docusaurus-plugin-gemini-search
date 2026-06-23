# Gemini Search

[![npm version](https://img.shields.io/npm/v/docusaurus-plugin-gemini-search.svg)](https://www.npmjs.com/package/docusaurus-plugin-gemini-search)
[![license](https://img.shields.io/npm/l/docusaurus-plugin-gemini-search.svg)](./LICENSE)

A Docusaurus-focused Gemini File Search toolkit for docs. The package is API-first: it gives you a Gemini search core, a Fetch API handler, and a sync CLI, while UI stays in your own site or the example app.

This package provides:

- a runtime-agnostic Gemini File Search core
- a Fetch `Request -> Response` adapter for server runtimes
- a CLI for creating and syncing Gemini File Search stores
- an example Docusaurus Ask AI page you can copy if you want a starter UI

## Prepare Gemini

You need a Gemini API key and a Gemini File Search store before the API can answer questions.

Install the package in your docs project:

```bash
npm install docusaurus-plugin-gemini-search
```

Set your Gemini API key:

```env
GEMINI_API_KEY=
```

Create a Gemini File Search store:

```bash
npx gemini-search create-store
```

Copy the printed `fileSearchStores/...` value into:

```env
GEMINI_FILE_SEARCH_STORE_NAME=fileSearchStores/...
```

Set your public docs URL:

```env
GEMINI_SEARCH_SITE_URL=https://docs.example.com
```

## Choose An Integration

### Fetch Handler

Use this when your server runtime accepts Web Fetch `Request` objects and returns `Response` objects. This fits Next.js route handlers, Hono, Cloudflare-style runtimes, and many modern server frameworks.

```ts
import {createGeminiSearchFetchHandler} from 'docusaurus-plugin-gemini-search/fetch';

const handleGeminiSearch = createGeminiSearchFetchHandler({
  prompt: [
    'You are a strict documentation question-answering assistant.',
    'Use only the retrieved documentation to answer.',
    'If the documentation does not contain enough information, say that clearly.',
  ].join(' '),
});

export function POST(request: Request) {
  return handleGeminiSearch(request);
}
```

Your UI can call that route with:

```json
{
  "question": "How do I install this?",
  "previousInteractionId": "optional-previous-interaction-id"
}
```

The response includes an `interactionId`. Store that value in your UI and send it as `previousInteractionId` on the next turn to continue the conversation with Gemini's server-side interaction history.

### Core API

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

## Add To An Existing Docusaurus Site

Installing the package does not automatically create a page or an API route. Add the Fetch handler above to your server runtime, then sync your docs:

```bash
npx gemini-search sync --dry-run
npx gemini-search sync
```

Sync keeps a local `.gemini-search/manifest.json` and skips unchanged documents on later runs.

For local API testing, use the example `npm run api` or your own framework's dev server.

## Deploy

### Vercel

Create an API route in your Docusaurus project:

```ts
// api/gemini-search.ts
import {createGeminiSearchFetchHandler} from 'docusaurus-plugin-gemini-search/fetch';

const handler = createGeminiSearchFetchHandler();

export async function POST(request: Request) {
  return handler(request);
}
```

Add a `vercel.json` if your project does not already configure Docusaurus output:

```json
{
  "buildCommand": "docusaurus build",
  "outputDirectory": "build"
}
```

Set these environment variables in Vercel:

```env
GEMINI_API_KEY=
GEMINI_FILE_SEARCH_STORE_NAME=fileSearchStores/...
GEMINI_SEARCH_SITE_URL=https://docs.example.com
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

Use `createGeminiSearchFetchHandler` anywhere your server runtime accepts a Web Fetch `Request` and returns a `Response`, such as Hono, modern Next.js route handlers, Deno, Bun, or an adapter around Express/Fastify.

## Run The Example

Build the package first:

```bash
git clone git@github.com:zxcv1884/docusaurus-plugin-gemini-search.git
cd docusaurus-plugin-gemini-search
npm install
npm run build
```

Start the example API:

```bash
cd examples/docusaurus
npm install
cp .env.example .env.local
npm run api
```

The API runs at:

```text
http://127.0.0.1:3021/api/gemini-search
```

Without Gemini credentials, it returns:

```json
{"error":"Gemini Search is not configured"}
```

That is expected. It means the API server is running.

To open the example Docusaurus page, use another terminal:

```bash
cd examples/docusaurus
npm start
```

Open:

```text
http://127.0.0.1:3020/ask-ai
```

The Ask AI page lives in `examples/docusaurus/src/pages/ask-ai.tsx`. Copy it into your own site only if you want that starter UI.

## UI

The package does not ship a Docusaurus page component. That keeps the npm package small and avoids forcing a UI shape on every site.

If you want a starter page, copy these files from the example:

```text
examples/docusaurus/src/pages/ask-ai.tsx
examples/docusaurus/src/pages/ask-ai.module.css
```

Then change the page's `apiPath` to your deployed API route.

## Notes

The API runs stateless by default. Public deployments should add rate limiting before calling Gemini. Use your hosting provider, WAF, gateway, middleware, or the `checkAccess` option on the Fetch handler.

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
```

`--source` can be repeated and uses `<dir>,<basePathname>[,<section>]`. When `--source` is present, it takes precedence over `--docs-dir`.

Sync writes `.gemini-search/manifest.json` under your project root to track uploaded content hashes. Delete that file if you need to force a full re-upload.

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
