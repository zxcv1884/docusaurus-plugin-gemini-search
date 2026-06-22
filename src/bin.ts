#!/usr/bin/env node

import process from 'node:process';
import {syncGeminiSearch} from './sync.js';

const command = process.argv[2] || 'help';
const args = new Set(process.argv.slice(3));

try {
  if (command === 'sync') {
    await syncGeminiSearch({
      dryRun: args.has('--dry-run'),
      createStore: args.has('--create-store'),
    });
  } else if (command === 'create-store') {
    await syncGeminiSearch({createStore: true});
  } else if (command === 'doctor') {
    printDoctor();
  } else {
    printHelp();
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

function printHelp() {
  console.log(`gemini-search

Commands:
  gemini-search sync [--dry-run]      Upload docs/ to Gemini File Search
  gemini-search create-store          Create a Gemini File Search store
  gemini-search doctor                Check required environment variables
`);
}

function printDoctor() {
  const checks = [
    ['GEMINI_API_KEY or GOOGLE_API_KEY', Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY)],
    ['GEMINI_FILE_SEARCH_STORE_NAME', Boolean(process.env.GEMINI_FILE_SEARCH_STORE_NAME)],
    ['GEMINI_SEARCH_SITE_URL or SITE_URL', Boolean(process.env.GEMINI_SEARCH_SITE_URL || process.env.SITE_URL)],
  ];

  for (const [label, ok] of checks) {
    console.log(`${ok ? 'OK  ' : 'MISS'} ${label}`);
  }
}
