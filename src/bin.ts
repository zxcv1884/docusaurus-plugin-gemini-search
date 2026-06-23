#!/usr/bin/env node

import process from 'node:process';
import {runCli} from './cli.js';

try {
  await runCli();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
