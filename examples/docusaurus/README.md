# Docusaurus Example

This example shows two things:

1. how to run the Gemini Search API with the Fetch handler
2. how an optional Docusaurus Ask AI page can call that API

## Run The Preview

From the repository root:

```bash
npm run build
cd examples/docusaurus
npm install
cp .env.example .env.local
npm run build
npm run preview
```

The example `preview` script enables streaming with `gemini-search preview --stream`, so the Ask AI page can consume Server-Sent Events locally.

The preview runs at:

```text
http://127.0.0.1:3021/ask-ai
```

The API route is mounted at:

```text
http://127.0.0.1:3021/api/gemini-search
```

Without Gemini credentials, that API route returns:

```json
{"error":"Gemini Search is not configured"}
```

That is expected and means the API route is running.

The page is only a template. Customers can copy it, swizzle it, or build their own UI against the API.

## API Template

The copyable Fetch handler template is:

```text
api/gemini-search.ts
```

Deploy a server-side route or serverless function with this handler. The Docusaurus plugin does not automatically publish a production API route, and the Gemini API key must stay on the server.

Deploy that route with your Docusaurus site and configure:

```env
GEMINI_API_KEY=
GEMINI_FILE_SEARCH_STORE_NAME=fileSearchStores/...
GEMINI_SEARCH_SITE_URL=https://docs.example.com
```

## Sync Check

```bash
npm run sync
```
