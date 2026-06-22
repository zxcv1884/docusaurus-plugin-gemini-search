# Docusaurus + Vercel Example

Build the package from the repository root:

```bash
npm run build
cd examples/docusaurus-vercel
npm install
```

Run the local API in one terminal:

```bash
cp .env.example .env.local
npm run api
```

Run the optional Docusaurus Ask AI template in another terminal:

```bash
npm start
```

Open `http://127.0.0.1:3020/ask-ai`.

The API runs at `http://127.0.0.1:3021/api/gemini-search`. Without Gemini credentials it will return a configuration error, but the server and template are still useful for integration testing.

The `api/gemini-search.ts` file shows the Vercel route customers can deploy. The Docusaurus page is only a template; customers can copy it, swizzle it, or build their own UI against the same API.

For local sync checks:

```bash
npm run sync
```
