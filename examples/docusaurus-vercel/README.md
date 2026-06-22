# Docusaurus + Vercel Example

This example shows two things:

1. how to run the Gemini Search API
2. how an optional Docusaurus Ask AI page can call that API

## Run The API

From the repository root:

```bash
npm run build
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

That is expected and means the API route is running.

## Open The Optional Page Template

In another terminal:

```bash
cd examples/docusaurus-vercel
npm start
```

Open:

```text
http://127.0.0.1:3020/ask-ai
```

The page is only a template. Customers can copy it, swizzle it, or build their own UI against the API.

## Vercel Route Template

The Vercel route example is:

```text
api/gemini-search.ts
```

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
