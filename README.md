# Gemini Search

A Docusaurus-focused Gemini File Search toolkit for docs. The package is API-first: it gives you a server handler and sync CLI, while UI stays in your own site or the example app.

This package provides:

- a Vercel-compatible API handler for Gemini File Search
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

To open the example Docusaurus page, use another terminal:

```bash
cd examples/docusaurus-vercel
npm start
```

Open:

```text
http://127.0.0.1:3020/ask-ai
```

The Ask AI page lives in `examples/docusaurus-vercel/src/pages/ask-ai.tsx`. Copy it into your own site only if you want that starter UI.

## Add To An Existing Docusaurus Site

Install the package if you have not already:

```bash
npm install docusaurus-plugin-gemini-search
```

Installing the package does not automatically create a page or an API route. Add the route file below to your site. On Vercel, this file becomes the API function.

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

Use the three environment variables from `Prepare Gemini` in your deployment.

Sync your docs:

```bash
npx gemini-search sync --dry-run
npx gemini-search sync
```

Deploy your Docusaurus site and `api/gemini-search.ts` route to Vercel. For local API testing, use `vercel dev` or a small local server like the one in `examples/docusaurus-vercel`.

Your UI can now call:

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

## UI

The package does not ship a Docusaurus page component. That keeps the npm package small and avoids forcing a UI shape on every site.

If you want a starter page, copy these files from the example:

```text
examples/docusaurus-vercel/src/pages/ask-ai.tsx
examples/docusaurus-vercel/src/pages/ask-ai.module.css
```

Then change the page's `apiPath` to your deployed API route.

## Notes

The API runs stateless by default. Public deployments should add rate limiting before calling Gemini. Use your hosting provider, WAF, gateway, middleware, or the `checkAccess` option.

## Options Reference

### Server Handler Options

```ts
createGeminiSearchVercelHandler({
  // Optional overrides. By default, the handler reads the required env vars above.
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

### Package Entrypoints

```ts
import {createGeminiSearchVercelHandler} from 'docusaurus-plugin-gemini-search/server';
import {syncGeminiSearch} from 'docusaurus-plugin-gemini-search/sync';
```

The default `docusaurus-plugin-gemini-search` export is intentionally minimal and does not mount routes.

## License

MIT
