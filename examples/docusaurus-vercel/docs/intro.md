---
title: Example Docs
---

# Example Docs

This is a small Docusaurus site for testing `docusaurus-plugin-gemini-search`.

The Ask AI page is mounted at `/ask-ai`. It sends questions to `/api/gemini-search`, which is intended to run as a Vercel function.

## What this example includes

- A Docusaurus plugin configuration.
- A Vercel API route using `createGeminiSearchVercelHandler`.
- A small docs set that can be uploaded with `gemini-search sync`.

