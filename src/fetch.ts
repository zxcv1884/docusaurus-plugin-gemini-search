import {
  createGeminiSearch,
  GeminiSearchError,
  validateGeminiSearchInput,
  type GeminiSearch,
  type GeminiSearchAskInput,
  type GeminiSearchOptions,
} from './core.js';

const MAX_RAW_BODY_BYTES = 128 * 1024;

export type {
  AnswerTransformContext,
  Citation,
  CitationFilterContext,
  GeminiSearch,
  GeminiSearchAskInput,
  GeminiSearchErrorCode,
  GeminiSearchOptions,
  GeminiSearchResult,
} from './core.js';

export type GeminiSearchFetchHandlerOptions = GeminiSearchOptions & {
  allowedOrigins?: string[];
  checkAccess?: (context: AccessContext) => MaybePromise<AccessResult | void>;
  onError?: (error: unknown, context: ErrorContext) => MaybePromise<void>;
};

export type AccessContext = {
  request: Request;
  body: unknown;
  question: string;
  previousInteractionId?: string;
  clientIp: string;
  requestOrigin: string;
};

export type AccessResult =
  | {allowed: true}
  | {
    allowed: false;
    statusCode?: number;
    error?: string;
    headers?: Record<string, string>;
    body?: unknown;
  };

export type ErrorContext = {
  request: Request;
  question?: string;
  previousInteractionId?: string;
};

type MaybePromise<T> = T | Promise<T>;

type HttpResult = {
  statusCode: number;
  body: unknown;
  headers?: Record<string, string>;
};

class RequestBodyError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'RequestBodyError';
    this.statusCode = statusCode;
  }
}

export function createGeminiSearchFetchHandler(options: GeminiSearchFetchHandlerOptions = {}) {
  const search = createGeminiSearch(options);

  return async function geminiSearchFetchHandler(request: Request): Promise<Response> {
    const result = await handleGeminiSearchRequest({
      options,
      search,
      request,
      clientIp: getClientIp(request),
      requestOrigin: getRequestOrigin(request),
    });

    return Response.json(result.body, {
      status: result.statusCode,
      headers: {
        'Cache-Control': 'no-store',
        ...(result.headers || {}),
      },
    });
  };
}

async function handleGeminiSearchRequest({
  options,
  search,
  request,
  clientIp,
  requestOrigin,
}: {
  options: GeminiSearchFetchHandlerOptions;
  search: GeminiSearch;
  request: Request;
  clientIp: string;
  requestOrigin: string;
}): Promise<HttpResult> {
  if (request.method !== 'POST') {
    return {statusCode: 405, body: {error: 'Method not allowed'}};
  }

  if (!isAllowedOrigin(request.headers.get('origin') || '', requestOrigin, options)) {
    return {statusCode: 403, body: {error: 'Origin is not allowed'}};
  }

  let body: unknown;
  try {
    body = await readJsonBody(request);
  } catch (error) {
    if (error instanceof RequestBodyError) {
      return {statusCode: error.statusCode, body: {error: error.message}};
    }

    return {statusCode: 400, body: {error: 'Invalid JSON body'}};
  }

  const input = parseGeminiSearchInput(body);
  try {
    validateGeminiSearchInput(input.question, input.previousInteractionId);
  } catch (error) {
    return toErrorResult(error);
  }

  const access = await checkAccess(options, {
    request,
    body,
    question: input.question,
    previousInteractionId: input.previousInteractionId,
    clientIp,
    requestOrigin,
  });
  if (access.allowed === false) {
    return {
      statusCode: access.statusCode || 403,
      headers: access.headers,
      body: access.body || {error: access.error || 'Request is not allowed'},
    };
  }

  try {
    return {
      statusCode: 200,
      body: await search.ask(input),
    };
  } catch (error) {
    if (error instanceof GeminiSearchError) {
      return toErrorResult(error);
    }

    console.error('Gemini Search request failed:', error);
    await options.onError?.(error, {
      request,
      question: input.question,
      previousInteractionId: input.previousInteractionId,
    });
    return {statusCode: 502, body: {error: 'Failed to generate an answer'}};
  }
}

function parseGeminiSearchInput(body: unknown): GeminiSearchAskInput {
  const value = body && typeof body === 'object' ? body as Record<string, unknown> : {};
  return {
    question: typeof value.question === 'string' ? value.question.trim() : '',
    previousInteractionId: typeof value.previousInteractionId === 'string' ? value.previousInteractionId.trim() : undefined,
  };
}

function toErrorResult(error: unknown): HttpResult {
  if (error instanceof GeminiSearchError) {
    return {statusCode: error.statusCode, body: {error: error.message}};
  }

  return {statusCode: 500, body: {error: 'Gemini Search failed'}};
}

async function readJsonBody(request: Request) {
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > MAX_RAW_BODY_BYTES) {
    throw new RequestBodyError('Request body is too large', 413);
  }

  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_RAW_BODY_BYTES) {
    throw new RequestBodyError('Request body is too large', 413);
  }

  return JSON.parse(text);
}

function isAllowedOrigin(origin: string, requestOrigin: string, options: GeminiSearchFetchHandlerOptions) {
  if (!origin) {
    return true;
  }

  const allowed = [
    ...(options.allowedOrigins || []),
    requestOrigin,
  ].filter(Boolean);

  return allowed.some((allowedOrigin) => {
    if (allowedOrigin.startsWith('https://*.')) {
      return origin.endsWith(allowedOrigin.replace('https://*', ''));
    }
    return origin === allowedOrigin.replace(/\/$/, '');
  });
}

function getRequestOrigin(request: Request) {
  const forwardedHost = request.headers.get('x-forwarded-host');
  const forwardedProto = request.headers.get('x-forwarded-proto');
  if (forwardedHost) {
    return `${forwardedProto || 'https'}://${forwardedHost}`;
  }

  return new URL(request.url).origin;
}

function getClientIp(request: Request) {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || request.headers.get('cf-connecting-ip')
    || 'unknown';
}

async function checkAccess(options: GeminiSearchFetchHandlerOptions, context: AccessContext): Promise<AccessResult> {
  const result = await options.checkAccess?.(context);
  return result || {allowed: true};
}
