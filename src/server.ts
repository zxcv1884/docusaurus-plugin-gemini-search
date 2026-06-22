const DEFAULT_MODEL = 'gemini-3.1-flash-lite';
const DEFAULT_MAX_OUTPUT_TOKENS = 1200;
const MAX_RAW_BODY_BYTES = 128 * 1024;
const MAX_QUESTION_LENGTH = 1200;

export type Citation = {
  title: string;
  url?: string;
  snippet?: string;
  sourcePath?: string;
};

export type GeminiSearchHandlerOptions = {
  apiKey?: string;
  fileSearchStoreName?: string;
  model?: string;
  siteUrl?: string;
  allowedOrigins?: string[];
  prompt?: string;
  systemInstruction?: string;
  checkAccess?: (context: AccessContext) => MaybePromise<AccessResult | void>;
  transformAnswer?: (answer: string, context: AnswerTransformContext) => MaybePromise<string>;
  filterCitation?: (citation: Citation, context: CitationFilterContext) => MaybePromise<boolean>;
  onError?: (error: unknown, context: ErrorContext) => MaybePromise<void>;
};

export type AccessContext = {
  req: any;
  body: unknown;
  question: string;
  conversationId: string;
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

export type AnswerTransformContext = {
  question: string;
  conversationId: string;
  response: unknown;
  citations: Citation[];
};

export type CitationFilterContext = {
  question: string;
  conversationId: string;
  response: unknown;
  answer: string;
};

export type ErrorContext = {
  req: any;
  question?: string;
  conversationId?: string;
};

type MaybePromise<T> = T | Promise<T>;

export function createGeminiSearchVercelHandler(options: GeminiSearchHandlerOptions = {}) {
  return async function geminiSearchHandler(req: any, res: any) {
    if (req.method !== 'POST') {
      return sendJson(res, 405, {error: 'Method not allowed'});
    }

    if (!isAllowedOrigin(req, options)) {
      return sendJson(res, 403, {error: 'Origin is not allowed'});
    }

    let body: any;
    try {
      body = await readJsonBody(req);
    } catch {
      return sendJson(res, 400, {error: 'Invalid JSON body'});
    }

    const conversationId = typeof body?.conversationId === 'string' ? body.conversationId.trim() : '';
    const question = typeof body?.question === 'string' ? body.question.trim() : '';

    if (!/^[A-Za-z0-9_-]{8,100}$/.test(conversationId)) {
      return sendJson(res, 400, {error: 'Conversation ID is invalid'});
    }

    if (!question) {
      return sendJson(res, 400, {error: 'Question is required'});
    }

    if (question.length > MAX_QUESTION_LENGTH) {
      return sendJson(res, 400, {error: `Question must be ${MAX_QUESTION_LENGTH} characters or fewer`});
    }

    const clientIp = getClientIp(req);
    const requestOrigin = getRequestOrigin(req);
    const access = await checkAccess(options, {
      req,
      body,
      question,
      conversationId,
      clientIp,
      requestOrigin,
    });
    if (access.allowed === false) {
      return sendAccessDenied(res, access);
    }

    const apiKey = options.apiKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';
    const fileSearchStoreName = options.fileSearchStoreName || process.env.GEMINI_FILE_SEARCH_STORE_NAME || '';

    if (!apiKey || !fileSearchStoreName) {
      return sendJson(res, 500, {error: 'Gemini Search is not configured'});
    }

    if (!fileSearchStoreName.startsWith('fileSearchStores/')) {
      return sendJson(res, 500, {error: 'GEMINI_FILE_SEARCH_STORE_NAME must look like fileSearchStores/...'});
    }

    try {
      const {GoogleGenAI} = await import('@google/genai');
      const ai = new GoogleGenAI({apiKey});
      const response = await ai.models.generateContent({
        model: options.model || process.env.GEMINI_SEARCH_MODEL || DEFAULT_MODEL,
        contents: [{role: 'user', parts: [{text: question}]}],
        config: {
          temperature: 0,
          maxOutputTokens: getPositiveInt(process.env.GEMINI_SEARCH_MAX_OUTPUT_TOKENS, DEFAULT_MAX_OUTPUT_TOKENS),
          systemInstruction: resolveSystemInstruction(options),
          tools: [
            {
              fileSearch: {
                fileSearchStoreNames: [fileSearchStoreName],
              },
            },
          ],
        },
      });

      const rawAnswer = getResponseText(response);
      const rawCitations = extractCitations(response, rawAnswer, options.siteUrl || process.env.GEMINI_SEARCH_SITE_URL || '');
      const citations = await filterCitations(options, rawCitations, {
        question,
        conversationId,
        response,
        answer: rawAnswer,
      });
      const answer = await transformAnswer(options, rawAnswer, {
        question,
        conversationId,
        response,
        citations,
      });
      return sendJson(res, 200, {answer, citations});
    } catch (error) {
      console.error('Gemini Search request failed:', error);
      await options.onError?.(error, {req, question, conversationId});
      return sendJson(res, 502, {error: 'Failed to generate an answer'});
    }
  };
}

function sendJson(res: any, statusCode: number, payload: unknown) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  return res.status(statusCode).json(payload);
}

function sendAccessDenied(res: any, access: Extract<AccessResult, {allowed: false}>) {
  for (const [name, value] of Object.entries(access.headers || {})) {
    res.setHeader(name, value);
  }

  return sendJson(
    res,
    access.statusCode || 403,
    access.body || {error: access.error || 'Request is not allowed'},
  );
}

async function readJsonBody(req: any): Promise<unknown> {
  if (req.body && typeof req.body === 'object') {
    return req.body;
  }

  if (typeof req.body === 'string') {
    return JSON.parse(req.body);
  }

  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_RAW_BODY_BYTES) {
      throw new Error('Request body is too large');
    }
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function isAllowedOrigin(req: any, options: GeminiSearchHandlerOptions) {
  const origin = getHeader(req, 'origin');
  if (!origin) {
    return true;
  }

  const allowed = [
    ...(options.allowedOrigins || []),
    ...parseCsv(process.env.GEMINI_SEARCH_ALLOWED_ORIGINS),
    getRequestOrigin(req),
  ].filter(Boolean);

  return allowed.some((allowedOrigin) => {
    if (allowedOrigin.startsWith('https://*.')) {
      return origin.endsWith(allowedOrigin.replace('https://*', ''));
    }
    return origin === allowedOrigin.replace(/\/$/, '');
  });
}

function getHeader(req: any, name: string): string {
  const value = req.headers?.[name] ?? req.headers?.[name.toLowerCase()];
  return Array.isArray(value) ? value[0] || '' : String(value || '');
}

function getRequestOrigin(req: any) {
  const host = getHeader(req, 'x-forwarded-host') || getHeader(req, 'host');
  const proto = getHeader(req, 'x-forwarded-proto') || (host.startsWith('localhost') ? 'http' : 'https');
  return host ? `${proto}://${host}` : '';
}

function getClientIp(req: any) {
  return getHeader(req, 'x-forwarded-for').split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
}

function parseCsv(value?: string) {
  return (value || '').split(',').map((item) => item.trim().replace(/\/$/, '')).filter(Boolean);
}

function getDefaultSystemInstruction() {
  return [
    'You are a strict documentation question-answering assistant.',
    'Use only the retrieved File Search documents and conversation context.',
    'If the retrieved documents do not support an answer, say that the documentation does not contain enough information.',
    'Answer concisely with concrete documented names, versions, URLs, filenames, repositories, and commands when available.',
    'When answering from retrieved documents, include a short References section with source links when the source metadata provides URLs.',
  ].join(' ');
}

function resolveSystemInstruction(options: GeminiSearchHandlerOptions) {
  return (
    options.prompt
    || options.systemInstruction
    || process.env.GEMINI_SEARCH_PROMPT
    || process.env.GEMINI_SEARCH_SYSTEM_INSTRUCTION
    || getDefaultSystemInstruction()
  );
}

async function checkAccess(options: GeminiSearchHandlerOptions, context: AccessContext): Promise<AccessResult> {
  const result = await options.checkAccess?.(context);
  return result || {allowed: true};
}

async function transformAnswer(
  options: GeminiSearchHandlerOptions,
  answer: string,
  context: AnswerTransformContext,
) {
  return options.transformAnswer ? options.transformAnswer(answer, context) : answer;
}

async function filterCitations(
  options: GeminiSearchHandlerOptions,
  citations: Citation[],
  context: CitationFilterContext,
) {
  if (!options.filterCitation) {
    return citations;
  }

  const filtered: Citation[] = [];
  for (const citation of citations) {
    if (await options.filterCitation(citation, context)) {
      filtered.push(citation);
    }
  }
  return filtered;
}

function getResponseText(response: any) {
  if (typeof response?.text === 'string') {
    return response.text.trim();
  }

  return (response?.candidates || [])
    .flatMap((candidate: any) => candidate?.content?.parts || [])
    .filter((part: any) => !part?.thought)
    .map((part: any) => part?.text)
    .filter((text: unknown): text is string => typeof text === 'string')
    .join('')
    .trim();
}

function extractCitations(response: any, answer: string, siteUrl: string): Citation[] {
  const citations = new Map<string, Citation>();
  const chunks = response?.candidates?.[0]?.groundingMetadata?.groundingChunks || [];

  for (const chunk of Array.isArray(chunks) ? chunks : []) {
    const context = chunk?.retrievedContext || chunk?.retrieved_context;
    if (!context) {
      continue;
    }

    const metadata = metadataToRecord(context.customMetadata || context.custom_metadata);
    const url = metadata.url || context.uri || undefined;
    const title = metadata.displayName || metadata.title || context.title || metadata.sourcePath || 'Source';
    const key = url || title;
    if (!citations.has(key)) {
      citations.set(key, {
        title,
        url,
        sourcePath: metadata.sourcePath,
        snippet: typeof context.text === 'string' ? context.text.slice(0, 280) : undefined,
      });
    }
  }

  if (citations.size) {
    return [...citations.values()].slice(0, 6);
  }

  return extractMarkdownLinkCitations(answer, siteUrl);
}

function metadataToRecord(value: unknown): Record<string, string> {
  if (!Array.isArray(value)) {
    return {};
  }

  const record: Record<string, string> = {};
  for (const item of value) {
    const key = item?.key;
    const itemValue = item?.stringValue ?? item?.string_value;
    if (typeof key === 'string' && typeof itemValue === 'string') {
      record[key] = itemValue;
    }
  }
  return record;
}

function extractMarkdownLinkCitations(answer: string, siteUrl: string): Citation[] {
  const citations = new Map<string, Citation>();
  const markdownLinkPattern = /\[([^\]]+)\]\((https?:\/\/[^)\s]+|\/[^)\s]+)\)/g;

  for (const match of answer.matchAll(markdownLinkPattern)) {
    const title = match[1].replace(/[`*_]/g, '').trim();
    const url = normalizeUrl(match[2], siteUrl);
    if (url && !citations.has(url)) {
      citations.set(url, {title, url});
    }
  }

  return [...citations.values()].slice(0, 6);
}

function normalizeUrl(value: string, siteUrl: string) {
  if (value.startsWith('/') && siteUrl) {
    return `${siteUrl.replace(/\/$/, '')}${value}`;
  }
  return value;
}

function getPositiveInt(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}
