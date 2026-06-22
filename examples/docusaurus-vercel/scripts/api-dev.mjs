#!/usr/bin/env node

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {createGeminiSearchVercelHandler} from 'docusaurus-plugin-gemini-search/server';

loadEnvFile('.env');
loadEnvFile('.env.local');

const host = process.env.GEMINI_SEARCH_API_HOST || '127.0.0.1';
const port = Number(process.env.GEMINI_SEARCH_API_PORT || 3021);
const apiPath = process.env.GEMINI_SEARCH_API_ROUTE || '/api/gemini-search';
const allowedOrigins = parseCsv(process.env.GEMINI_SEARCH_ALLOWED_ORIGINS || 'http://127.0.0.1:3020');

const handler = createGeminiSearchVercelHandler({
  allowedOrigins,
  prompt: process.env.GEMINI_SEARCH_PROMPT || [
    'You are a strict documentation question-answering assistant.',
    'Use only the retrieved documentation to answer.',
    'If the documentation does not contain enough information, say that clearly.',
  ].join(' '),
});

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url || '/', `http://${req.headers.host || `${host}:${port}`}`);

  setCorsHeaders(req, res);

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (requestUrl.pathname !== apiPath) {
    sendJson(res, 404, {error: 'Not found'});
    return;
  }

  await handler(req, createVercelLikeResponse(res));
});

server.listen(port, host, () => {
  console.log(`Gemini Search API running at http://${host}:${port}${apiPath}`);
  console.log(`Allowed origins: ${allowedOrigins.join(', ') || '(same-origin only)'}`);
});

function createVercelLikeResponse(res) {
  return {
    setHeader(name, value) {
      res.setHeader(name, value);
    },
    status(statusCode) {
      res.statusCode = statusCode;
      return this;
    },
    json(payload) {
      sendJson(res, res.statusCode || 200, payload);
    },
  };
}

function sendJson(res, statusCode, payload) {
  if (!res.headersSent) {
    res.statusCode = statusCode;
    res.setHeader('Content-Type', 'application/json');
  }
  res.end(JSON.stringify(payload));
}

function setCorsHeaders(req, res) {
  const origin = req.headers.origin;
  if (typeof origin === 'string' && allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function parseCsv(value) {
  return value
    .split(',')
    .map((item) => item.trim().replace(/\/$/, ''))
    .filter(Boolean);
}

function loadEnvFile(filename) {
  const filepath = path.join(process.cwd(), filename);
  if (!fs.existsSync(filepath)) {
    return;
  }

  const content = fs.readFileSync(filepath, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) {
      continue;
    }
    const [key, ...rest] = trimmed.split('=');
    if (!process.env[key]) {
      process.env[key] = rest.join('=').replace(/^["']|["']$/g, '');
    }
  }
}

