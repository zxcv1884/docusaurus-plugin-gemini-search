---
title: Example Docs
---

# Example Docs

This is a small Docusaurus site for testing `docusaurus-plugin-gemini-search`.

The Ask AI page is mounted at `/ask-ai`. It sends questions to `/api/gemini-search`, which is backed by `createGeminiSearchFetchHandler`.

## What this example includes

- A Docusaurus site with a copyable Ask AI page.
- A small local API server using the Fetch handler.
- A small docs set that can be uploaded with `gemini-search sync`.
