# Gemini Search

A Docusaurus plugin for adding a Gemini-powered AI assistant to your docs.

This package provides:

- a Vercel-compatible API handler for Gemini File Search
- an optional Docusaurus Ask AI page template
- a CLI for creating and syncing Gemini File Search stores

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
cd examples/docusaurus-vercel
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

To open the optional Docusaurus page template, use another terminal:

```bash
cd examples/docusaurus-vercel
npm start
```

Open:

```text
http://127.0.0.1:3020/ask-ai
```

The Ask AI page is only a template. You can copy it, swizzle it, or build your own UI against the same API.

## Add To An Existing Docusaurus Site

Install the package:

```bash
npm install docusaurus-plugin-gemini-search
```

Installing the package does not automatically create `/api/gemini-search`.
Add the route file below to your site. On Vercel, this file becomes the API function.

Add the Vercel API route:

```ts
// api/gemini-search.ts
import {createGeminiSearchVercelHandler} from 'docusaurus-plugin-gemini-search/server';

export default createGeminiSearchVercelHandler({
  prompt: [
    'You are a strict documentation question-answering assistant.',
    'Use only the retrieved documentation to answer.',
    'If the documentation does not contain enough information, say that clearly.',
  ].join(' '),
});
```

Set environment variables:

```env
GEMINI_API_KEY=
GEMINI_FILE_SEARCH_STORE_NAME=fileSearchStores/...
GEMINI_SEARCH_SITE_URL=https://docs.example.com
```

Create a Gemini File Search store:

```bash
npx gemini-search create-store
```

Copy the printed `fileSearchStores/...` value into `GEMINI_FILE_SEARCH_STORE_NAME`.

Sync your docs:

```bash
npx gemini-search sync --dry-run
npx gemini-search sync
```

Deploy your Docusaurus site and `api/gemini-search.ts` route to Vercel.
For local API testing, use `vercel dev` or a small local server like the one in `examples/docusaurus-vercel`.

Your existing UI can now call:

```text
POST /api/gemini-search
```

with:

```json
{
  "conversationId": "your-conversation-id",
  "question": "How do I install this?"
}
```

## Notes

The API runs stateless by default. Public deployments should add rate limiting before calling Gemini. Use your hosting provider, WAF, gateway, middleware, or the `checkAccess` option.

The Docusaurus page template is optional. The main integration surface is the API handler.

## Options Reference

### Server Handler Options

```ts
createGeminiSearchVercelHandler({
  apiKey: process.env.GEMINI_API_KEY,
  fileSearchStoreName: process.env.GEMINI_FILE_SEARCH_STORE_NAME,
  model: 'gemini-3.1-flash-lite',
  siteUrl: 'https://docs.example.com',
  allowedOrigins: ['https://docs.example.com'],
  prompt: 'Answer only from retrieved documentation.',
  async checkAccess({clientIp}) {
    return {allowed: true};
  },
  transformAnswer(answer) {
    return answer;
  },
  filterCitation(citation) {
    return true;
  },
  onError(error) {
    console.error(error);
  },
});
```

### Environment Variables

```env
GEMINI_API_KEY=
GEMINI_FILE_SEARCH_STORE_NAME=fileSearchStores/...
GEMINI_SEARCH_SITE_URL=https://docs.example.com
```

### Package Entrypoints

```ts
import geminiSearchPlugin from 'docusaurus-plugin-gemini-search';
import GeminiSearchPanel from 'docusaurus-plugin-gemini-search/client';
import {createGeminiSearchVercelHandler} from 'docusaurus-plugin-gemini-search/server';
import {syncGeminiSearch} from 'docusaurus-plugin-gemini-search/sync';
```

## License

MIT
