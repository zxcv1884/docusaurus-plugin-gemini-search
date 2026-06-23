import {
  createGeminiSearch,
  GeminiSearchError,
  validateGeminiSearchInput,
  type GeminiSearch,
  type GeminiSearchAskInput,
  type GeminiSearchOptions,
  type GeminiSearchStreamEvent,
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
  GeminiSearchStreamEvent,
} from './core.js';

export type GeminiSearchFetchHandlerOptions = GeminiSearchOptions & {
  allowedOrigins?: string[];
  stream?: boolean;
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

type PreparedRequest =
  | {
    ok: true;
    input: GeminiSearchAskInput;
  }
  | {
    ok: false;
    result: HttpResult;
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
    const prepared = await prepareGeminiSearchRequest({
      options,
      request,
      clientIp: getClientIp(request),
      requestOrigin: getRequestOrigin(request),
    });

    if (!prepared.ok) {
      return jsonResponse(prepared.result);
    }

    if (options.stream) {
      return streamResponse(search.stream(prepared.input), options, request, prepared.input);
    }

    const result = await handleGeminiSearchRequest({
      options,
      search,
      request,
      input: prepared.input,
    });

    return jsonResponse(result);
  };
}

function jsonResponse(result: HttpResult) {
  return Response.json(result.body, {
    status: result.statusCode,
    headers: {
      'Cache-Control': 'no-store',
      ...(result.headers || {}),
    },
  });
}

function streamResponse(
  events: AsyncIterable<GeminiSearchStreamEvent>,
  options: GeminiSearchFetchHandlerOptions,
  request: Request,
  input: GeminiSearchAskInput,
) {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of events) {
          if (request.signal?.aborted) {
            break;
          }
          controller.enqueue(encoder.encode(formatSseEvent(event.type, event)));
        }
      } catch (error) {
        if (request.signal?.aborted) {
          return;
        }
        const result = error instanceof GeminiSearchError
          ? {error: error.message}
          : {error: 'Failed to generate an answer'};
        if (!(error instanceof GeminiSearchError)) {
          console.error('Gemini Search stream failed:', error);
          await options.onError?.(error, {
            request,
            question: input.question,
            previousInteractionId: input.previousInteractionId,
          });
        }
        try {
          controller.enqueue(encoder.encode(formatSseEvent('error', result)));
        } catch {
          // Ignore write errors to closed stream
        }
      } finally {
        try {
          controller.close();
        } catch {
          // Ignore close errors to closed stream
        }
      }
    },
  });

  return new Response(body, {
    status: 200,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'text/event-stream; charset=utf-8',
      'X-Accel-Buffering': 'no',
    },
  });
}

function formatSseEvent(event: string, data: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

async function prepareGeminiSearchRequest({
  options,
  request,
  clientIp,
  requestOrigin,
}: {
  options: GeminiSearchFetchHandlerOptions;
  request: Request;
  clientIp: string;
  requestOrigin: string;
}): Promise<PreparedRequest> {
  if (request.method !== 'POST') {
    return {ok: false, result: {statusCode: 405, body: {error: 'Method not allowed'}}};
  }

  if (!isAllowedOrigin(request.headers.get('origin') || '', requestOrigin, options)) {
    return {ok: false, result: {statusCode: 403, body: {error: 'Origin is not allowed'}}};
  }

  let body: unknown;
  try {
    body = await readJsonBody(request);
  } catch (error) {
    if (error instanceof RequestBodyError) {
      return {ok: false, result: {statusCode: error.statusCode, body: {error: error.message}}};
    }

    return {ok: false, result: {statusCode: 400, body: {error: 'Invalid JSON body'}}};
  }

  const input = parseGeminiSearchInput(body);
  try {
    validateGeminiSearchInput(input.question, input.previousInteractionId);
  } catch (error) {
    return {ok: false, result: toErrorResult(error)};
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
      ok: false,
      result: {
        statusCode: access.statusCode || 403,
        headers: access.headers,
        body: access.body || {error: access.error || 'Request is not allowed'},
      },
    };
  }

  return {ok: true, input};
}

async function handleGeminiSearchRequest({
  options,
  search,
  request,
  input,
}: {
  options: GeminiSearchFetchHandlerOptions;
  search: GeminiSearch;
  request: Request;
  input: GeminiSearchAskInput;
}): Promise<HttpResult> {
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
