#!/usr/bin/env node

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {createGeminiSearchFetchHandler} from 'docusaurus-plugin-gemini-search/fetch';

loadEnvFile('.env');
loadEnvFile('.env.local');

const host = '127.0.0.1';
const port = 3021;
const apiPath = '/api/gemini-search';
const allowedOrigins = ['http://127.0.0.1:3020'];

const handler = createGeminiSearchFetchHandler({
  allowedOrigins,
  prompt: [
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

  const request = await createFetchRequest(req, requestUrl);
  const response = await handler(request);
  await sendFetchResponse(res, response);
});

server.listen(port, host, () => {
  console.log(`Gemini Search API running at http://${host}:${port}${apiPath}`);
  console.log(`Allowed origins: ${allowedOrigins.join(', ') || '(same-origin only)'}`);
});

async function createFetchRequest(req, requestUrl) {
  const body = req.method === 'GET' || req.method === 'HEAD'
    ? undefined
    : await readRequestBody(req);

  return new Request(requestUrl, {
    method: req.method,
    headers: normalizeHeaders(req.headers),
    body,
  });
}

function normalizeHeaders(headers) {
  const normalized = new Headers();
  for (const [name, value] of Object.entries(headers)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        normalized.append(name, item);
      }
    } else if (value !== undefined) {
      normalized.set(name, value);
    }
  }
  return normalized;
}

async function readRequestBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function sendFetchResponse(res, response) {
  res.statusCode = response.status;
  response.headers.forEach((value, name) => {
    res.setHeader(name, value);
  });
  res.end(Buffer.from(await response.arrayBuffer()));
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
