import fs from 'node:fs';
import http, {type IncomingMessage, type ServerResponse} from 'node:http';
import path from 'node:path';
import process from 'node:process';
import {createGeminiSearchFetchHandler} from './fetch.js';

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 3021;
const DEFAULT_API_PATH = '/api/gemini-search';
const DEFAULT_SITE_DIR = 'build';
const DEFAULT_ENV_FILES = ['.env', '.env.local'];

export type PreviewOptions = {
  apiPath?: string;
  siteDir?: string;
  host?: string;
  port?: number;
  cwd?: string;
  allowedOrigins?: string[];
  envFiles?: string[];
  log?: (line: string) => void;
};

export type PreviewServer = {
  server: http.Server;
  url: string;
  apiUrl: string;
  siteDir: string;
  loadedEnvFiles: string[];
};

type StaticResult =
  | {found: true; filepath: string; statusCode: number}
  | {found: false};

export async function startGeminiSearchPreview(options: PreviewOptions = {}): Promise<PreviewServer> {
  const cwd = options.cwd || process.cwd();
  const host = options.host || DEFAULT_HOST;
  const port = options.port ?? DEFAULT_PORT;
  const apiPath = normalizePathname(options.apiPath || DEFAULT_API_PATH);
  const siteDir = path.resolve(cwd, options.siteDir || DEFAULT_SITE_DIR);
  const loadedEnvFiles = loadEnvFiles(cwd, options.envFiles || DEFAULT_ENV_FILES);
  const allowedOrigins = options.allowedOrigins || [];
  const handler = createGeminiSearchFetchHandler({allowedOrigins});

  const server = http.createServer(async (req, res) => {
    try {
      const requestUrl = new URL(req.url || '/', `http://${req.headers.host || `${host}:${port}`}`);

      if (requestUrl.pathname === apiPath) {
        setCorsHeaders(req, res, requestUrl, allowedOrigins);

        if (req.method === 'OPTIONS') {
          res.statusCode = 204;
          res.end();
          return;
        }

        const request = await createFetchRequest(req, requestUrl);
        const response = await handler(request);
        await sendFetchResponse(res, response);
        return;
      }

      await serveStaticFile(req, res, requestUrl, siteDir);
    } catch (error) {
      console.error('Gemini Search preview request failed:', error);
      sendText(res, 500, 'Internal Server Error');
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve();
    });
  });

  const address = server.address();
  const actualPort = typeof address === 'object' && address ? address.port : port;
  const displayHost = host === '0.0.0.0' ? DEFAULT_HOST : host;
  const url = `http://${displayHost}:${actualPort}`;
  const apiUrl = `${url}${apiPath}`;
  const log = options.log || console.log;
  log(`Gemini Search preview running at ${url}`);
  log(`Gemini Search API mounted at ${apiUrl}`);
  log(`Serving Docusaurus build from ${siteDir}`);
  if (loadedEnvFiles.length) {
    log(`Loaded env files: ${loadedEnvFiles.join(', ')}`);
  }

  return {server, url, apiUrl, siteDir, loadedEnvFiles};
}

export function loadEnvFiles(cwd: string, filenames = DEFAULT_ENV_FILES): string[] {
  const loaded: string[] = [];
  const existingEnvKeys = new Set(Object.keys(process.env));

  for (const filename of filenames) {
    const filepath = path.resolve(cwd, filename);
    if (!fs.existsSync(filepath)) {
      continue;
    }

    loadEnvFile(filepath, existingEnvKeys);
    loaded.push(filename);
  }

  return loaded;
}

function loadEnvFile(filepath: string, existingEnvKeys: Set<string>) {
  const content = fs.readFileSync(filepath, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const parsed = parseEnvLine(line);
    if (!parsed) {
      continue;
    }
    if (existingEnvKeys.has(parsed.key)) {
      continue;
    }
    process.env[parsed.key] = parsed.value;
  }
}

function parseEnvLine(line: string) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) {
    return undefined;
  }

  const normalized = trimmed.startsWith('export ') ? trimmed.slice('export '.length).trim() : trimmed;
  const separatorIndex = normalized.indexOf('=');
  if (separatorIndex <= 0) {
    return undefined;
  }

  const key = normalized.slice(0, separatorIndex).trim();
  const rawValue = normalized.slice(separatorIndex + 1).trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
    return undefined;
  }

  return {
    key,
    value: unquoteEnvValue(rawValue),
  };
}

function unquoteEnvValue(value: string) {
  if (
    (value.startsWith('"') && value.endsWith('"'))
    || (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

async function serveStaticFile(
  req: IncomingMessage,
  res: ServerResponse,
  requestUrl: URL,
  siteDir: string,
) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendText(res, 405, 'Method Not Allowed');
    return;
  }

  const staticResult = findStaticFile(siteDir, requestUrl.pathname);
  if (!staticResult.found) {
    sendText(res, 404, 'Not Found');
    return;
  }

  res.statusCode = staticResult.statusCode;
  res.setHeader('Content-Type', getContentType(staticResult.filepath));
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'HEAD') {
    res.end();
    return;
  }

  fs.createReadStream(staticResult.filepath)
    .once('error', () => sendText(res, 500, 'Internal Server Error'))
    .pipe(res);
}

function findStaticFile(siteDir: string, pathname: string): StaticResult {
  const decodedPathname = safeDecodePathname(pathname);
  if (!decodedPathname) {
    return {found: false};
  }

  const candidatePaths = getStaticCandidates(siteDir, decodedPathname);
  for (const candidate of candidatePaths) {
    if (isInsideDir(siteDir, candidate) && isFile(candidate)) {
      return {found: true, filepath: candidate, statusCode: 200};
    }
  }

  const notFoundFile = path.join(siteDir, '404.html');
  if (isFile(notFoundFile)) {
    return {found: true, filepath: notFoundFile, statusCode: 404};
  }

  return {found: false};
}

function getStaticCandidates(siteDir: string, pathname: string) {
  const requestPath = pathname.replace(/^\/+/, '');
  const directPath = path.join(siteDir, requestPath);
  if (!requestPath || pathname.endsWith('/')) {
    return [path.join(directPath, 'index.html')];
  }

  return [
    directPath,
    path.join(directPath, 'index.html'),
  ];
}

function safeDecodePathname(pathname: string) {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return undefined;
  }
}

function isInsideDir(parentDir: string, filepath: string) {
  const relativePath = path.relative(parentDir, filepath);
  return relativePath && !relativePath.startsWith('..') && !path.isAbsolute(relativePath);
}

function isFile(filepath: string) {
  try {
    return fs.statSync(filepath).isFile();
  } catch {
    return false;
  }
}

async function createFetchRequest(req: IncomingMessage, requestUrl: URL) {
  const body = req.method === 'GET' || req.method === 'HEAD'
    ? undefined
    : await readRequestBody(req);

  return new Request(requestUrl, {
    method: req.method,
    headers: normalizeHeaders(req.headers),
    body,
  });
}

function normalizeHeaders(headers: IncomingMessage['headers']) {
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

async function readRequestBody(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function sendFetchResponse(res: ServerResponse, response: Response) {
  res.statusCode = response.status;
  response.headers.forEach((value, name) => {
    res.setHeader(name, value);
  });
  res.end(Buffer.from(await response.arrayBuffer()));
}

function setCorsHeaders(
  req: IncomingMessage,
  res: ServerResponse,
  requestUrl: URL,
  allowedOrigins: string[],
) {
  const origin = req.headers.origin;
  if (typeof origin === 'string' && isAllowedPreviewOrigin(origin, requestUrl.origin, allowedOrigins)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function isAllowedPreviewOrigin(origin: string, requestOrigin: string, allowedOrigins: string[]) {
  return origin === requestOrigin || allowedOrigins.includes(origin);
}

function sendText(res: ServerResponse, statusCode: number, text: string) {
  if (!res.headersSent) {
    res.statusCode = statusCode;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  }
  res.end(text);
}

function normalizePathname(pathname: string) {
  const normalized = pathname.startsWith('/') ? pathname : `/${pathname}`;
  return normalized.replace(/\/+$/, '') || '/';
}

function getContentType(filepath: string) {
  const extension = path.extname(filepath).toLowerCase();
  const contentTypes: Record<string, string> = {
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.ico': 'image/x-icon',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.map': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.txt': 'text/plain; charset=utf-8',
    '.webp': 'image/webp',
  };

  return contentTypes[extension] || 'application/octet-stream';
}
