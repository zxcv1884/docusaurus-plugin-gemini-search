# Gemini Search

Add a Gemini-powered AI assistant to your Docusaurus documentation.

This MVP ships as one package:

- `docusaurus-plugin-gemini-search` adds an `/ask-ai` route to Docusaurus.
- `docusaurus-plugin-gemini-search/server` provides a Vercel API handler.
- `gemini-search` CLI uploads `docs/` content to Gemini File Search.
- Production abuse protection is intentionally left to your hosting platform, gateway, WAF, or `checkAccess` hook.

## Install

```bash
npm install docusaurus-plugin-gemini-search
```

## Configure Docusaurus

```ts
// docusaurus.config.ts
const config = {
  plugins: [
    [
      'docusaurus-plugin-gemini-search',
      {
        routePath: '/ask-ai',
        apiPath: '/api/gemini-search',
        title: 'Ask AI',
        subtitle: 'Ask a question about this documentation.',
        suggestions: [
          {
            label: 'Getting started',
            question: 'How do I install and configure this project?',
          },
        ],
      },
    ],
  ],
};

export default config;
```

## Add the Vercel API route

```ts
// api/gemini-search.ts
import {createGeminiSearchVercelHandler} from 'docusaurus-plugin-gemini-search/server';

export default createGeminiSearchVercelHandler();
```

You can customize the Gemini system prompt from the API route:

```ts
// api/gemini-search.ts
import {createGeminiSearchVercelHandler} from 'docusaurus-plugin-gemini-search/server';

export default createGeminiSearchVercelHandler({
  prompt: [
    'You are the documentation assistant for Acme Docs.',
    'Answer only from retrieved documentation.',
    'If the docs do not contain the answer, say that clearly.',
  ].join(' '),
});
```

For public deployments, add rate limiting, auth, captcha, or tenant checks before calling Gemini:

```ts
// api/gemini-search.ts
import {createGeminiSearchVercelHandler} from 'docusaurus-plugin-gemini-search/server';

export default createGeminiSearchVercelHandler({
  async checkAccess({req, clientIp}) {
    const allowed = await myRateLimiter.allow(clientIp);

    if (!allowed) {
      return {
        allowed: false,
        statusCode: 429,
        error: 'Too many requests',
        headers: {'Retry-After': '60'},
      };
    }

    return {allowed: true};
  },
});
```

You can also customize output without forking:

```ts
export default createGeminiSearchVercelHandler({
  transformAnswer(answer) {
    return answer.replace(/^References[\s\S]*$/m, '').trim();
  },
  filterCitation(citation) {
    return citation.url?.startsWith('https://docs.example.com/') ?? false;
  },
});
```

## Environment variables

```env
GEMINI_API_KEY=
GEMINI_FILE_SEARCH_STORE_NAME=fileSearchStores/...
GEMINI_SEARCH_SITE_URL=https://example.com
GEMINI_SEARCH_MODEL=gemini-3.1-flash-lite

# Optional. Prefer the API route option for longer prompts.
GEMINI_SEARCH_PROMPT=
```

## Create a Gemini File Search store

```bash
npx gemini-search create-store
```

Copy the printed `fileSearchStores/...` value into `GEMINI_FILE_SEARCH_STORE_NAME`.

## Sync docs

```bash
npx gemini-search sync --dry-run
npx gemini-search sync
```

The sync command reads `docs/**/*.md` and `docs/**/*.mdx`, adds source metadata, and uploads each document to Gemini File Search.

## Check setup

```bash
npx gemini-search doctor
```

## Production notes

This package keeps the first deployment path intentionally narrow:

- Docusaurus for the website.
- Vercel functions for the server endpoint.
- Gemini File Search for retrieval.
- Your own production abuse protection before calling Gemini.

The API runs stateless by default. Public deployments should add rate limiting before calling Gemini. Use your hosting provider, WAF, gateway, middleware, or `checkAccess` hook.

## Package entrypoints

```ts
import geminiSearchPlugin from 'docusaurus-plugin-gemini-search';
import GeminiSearchPage from 'docusaurus-plugin-gemini-search/client';
import {createGeminiSearchVercelHandler} from 'docusaurus-plugin-gemini-search/server';
import {syncGeminiSearch} from 'docusaurus-plugin-gemini-search/sync';
```

## License

MIT
