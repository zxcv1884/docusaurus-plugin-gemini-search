---
title: Setup
---

# Setup

Install the example dependencies:

```bash
npm install
```

Start the local Docusaurus server:

```bash
npm start
```

Open `http://127.0.0.1:3020/ask-ai`.

To use Gemini File Search, configure:

```env
GEMINI_API_KEY=
GEMINI_FILE_SEARCH_STORE_NAME=fileSearchStores/...
GEMINI_SEARCH_SITE_URL=http://127.0.0.1:3020
```

Then run a dry sync:

```bash
npm run sync
```

