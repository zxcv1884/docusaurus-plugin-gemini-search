# Docusaurus + Vercel Example

Run this example from the repository root:

```bash
npm run build
cd examples/docusaurus-vercel
npm install
npm start
```

Open `http://127.0.0.1:3020/ask-ai`.

The UI will render without Gemini credentials. To call the API, copy `.env.example` to `.env.local`, fill in the Gemini values, deploy the `api/gemini-search.ts` route on Vercel, and point the site at that API route.

For local sync checks:

```bash
npm run sync
```

