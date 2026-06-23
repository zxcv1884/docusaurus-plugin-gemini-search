const DEFAULT_MODEL = 'gemini-3.1-flash-lite';
const DEFAULT_MAX_OUTPUT_TOKENS = 1200;
const MAX_QUESTION_LENGTH = 1200;
const INTERACTION_ID_PATTERN = /^[A-Za-z0-9_\-:.]{1,200}$/;
const MAX_RESPONSE_WALK_DEPTH = 10;

export type Citation = {
  title: string;
  url?: string;
  snippet?: string;
  sourcePath?: string;
};

export type GeminiSearchOptions = {
  apiKey?: string;
  fileSearchStoreName?: string;
  model?: string;
  siteUrl?: string;
  prompt?: string;
  systemInstruction?: string;
  client?: GeminiSearchClient;
  transformAnswer?: (answer: string, context: AnswerTransformContext) => MaybePromise<string>;
  filterCitation?: (citation: Citation, context: CitationFilterContext) => MaybePromise<boolean>;
};

export type GeminiSearchAskInput = {
  question: string;
  previousInteractionId?: string;
};

export type GeminiSearchResult = {
  answer: string;
  citations: Citation[];
  interactionId: string;
};

export type InteractionInput = {
  model: string;
  input: string;
  store: boolean;
  previous_interaction_id?: string;
  system_instruction: string;
  tools: Array<{
    type: 'file_search';
    file_search_store_names: string[];
  }>;
  generation_config: {
    temperature: number;
    max_output_tokens: number;
  };
};

export type InteractionResponse = {
  id?: string;
  output_text?: string;
  text?: string;
  steps?: unknown;
  candidates?: unknown[];
};

export type GeminiSearchClient = {
  interactions: {
    create(input: InteractionInput): Promise<InteractionResponse>;
  };
};

export type GeminiSearch = {
  ask(input: GeminiSearchAskInput): Promise<GeminiSearchResult>;
};

export type AnswerTransformContext = {
  question: string;
  previousInteractionId?: string;
  interactionId: string;
  response: unknown;
  citations: Citation[];
};

export type CitationFilterContext = {
  question: string;
  previousInteractionId?: string;
  interactionId: string;
  response: unknown;
  answer: string;
};

export type GeminiSearchErrorCode =
  | 'missing_question'
  | 'question_too_long'
  | 'invalid_interaction_id'
  | 'missing_configuration'
  | 'invalid_file_search_store';

type MaybePromise<T> = T | Promise<T>;

export class GeminiSearchError extends Error {
  readonly statusCode: number;
  readonly code: GeminiSearchErrorCode;

  constructor(code: GeminiSearchErrorCode, message: string, statusCode: number) {
    super(message);
    this.name = 'GeminiSearchError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

export function createGeminiSearch(options: GeminiSearchOptions = {}): GeminiSearch {
  let cachedClient: GeminiSearchClient | undefined;

  return {
    async ask(input) {
      const apiKey = options.apiKey || getEnvValue('GEMINI_API_KEY');
      if (apiKey && !options.client && !cachedClient) {
        cachedClient = await createGoogleGenAIClient(apiKey);
      }
      return askGeminiSearch(options, input, options.client || cachedClient);
    },
  };
}

export async function askGeminiSearch(
  options: GeminiSearchOptions = {},
  input: GeminiSearchAskInput,
  client?: GeminiSearchClient,
): Promise<GeminiSearchResult> {
  const question = input.question.trim();
  const previousInteractionId = input.previousInteractionId?.trim();

  validateGeminiSearchInput(question, previousInteractionId);

  const apiKey = options.apiKey || getEnvValue('GEMINI_API_KEY');
  const fileSearchStoreName = options.fileSearchStoreName || getEnvValue('GEMINI_FILE_SEARCH_STORE_NAME');

  if (!apiKey || !fileSearchStoreName) {
    throw new GeminiSearchError('missing_configuration', 'Gemini Search is not configured', 500);
  }

  if (!fileSearchStoreName.startsWith('fileSearchStores/')) {
    throw new GeminiSearchError(
      'invalid_file_search_store',
      'GEMINI_FILE_SEARCH_STORE_NAME must look like fileSearchStores/...',
      500,
    );
  }

  const ai = client || options.client || await createGoogleGenAIClient(apiKey);
  const response = await ai.interactions.create({
    model: options.model || DEFAULT_MODEL,
    input: question,
    store: true,
    ...(previousInteractionId ? {previous_interaction_id: previousInteractionId} : {}),
    system_instruction: resolveSystemInstruction(options),
    tools: [
      {
        type: 'file_search',
        file_search_store_names: [fileSearchStoreName],
      },
    ],
    generation_config: {
      temperature: 0,
      max_output_tokens: DEFAULT_MAX_OUTPUT_TOKENS,
    },
  });

  const rawAnswer = getResponseText(response);
  const interactionId = getInteractionId(response);
  const rawCitations = extractCitations(response, rawAnswer, options.siteUrl || getEnvValue('GEMINI_SEARCH_SITE_URL'));
  const citations = await filterCitations(options, rawCitations, {
    question,
    previousInteractionId,
    interactionId,
    response,
    answer: rawAnswer,
  });
  const answer = await transformAnswer(options, rawAnswer, {
    question,
    previousInteractionId,
    interactionId,
    response,
    citations,
  });

  return {answer, citations, interactionId};
}

export function validateGeminiSearchInput(question: string, previousInteractionId?: string) {
  if (!question) {
    throw new GeminiSearchError('missing_question', 'Question is required', 400);
  }

  if (question.length > MAX_QUESTION_LENGTH) {
    throw new GeminiSearchError('question_too_long', `Question must be ${MAX_QUESTION_LENGTH} characters or fewer`, 400);
  }

  if (previousInteractionId && !INTERACTION_ID_PATTERN.test(previousInteractionId)) {
    throw new GeminiSearchError('invalid_interaction_id', 'Interaction ID is invalid', 400);
  }
}

function getEnvValue(name: string) {
  return typeof process !== 'undefined' ? process.env?.[name] || '' : '';
}

async function createGoogleGenAIClient(apiKey: string): Promise<GeminiSearchClient> {
  const {GoogleGenAI} = await import('@google/genai');
  return new GoogleGenAI({apiKey});
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

function resolveSystemInstruction(options: GeminiSearchOptions) {
  return (
    options.prompt
    || options.systemInstruction
    || getDefaultSystemInstruction()
  );
}

async function transformAnswer(
  options: GeminiSearchOptions,
  answer: string,
  context: AnswerTransformContext,
) {
  return options.transformAnswer ? options.transformAnswer(answer, context) : answer;
}

async function filterCitations(
  options: GeminiSearchOptions,
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
  if (typeof response?.output_text === 'string') {
    return response.output_text.trim();
  }

  if (typeof response?.text === 'string') {
    return response.text.trim();
  }

  const stepText = extractTextFromSteps(response?.steps);
  if (stepText) {
    return stepText;
  }

  return (response?.candidates || [])
    .flatMap((candidate: any) => candidate?.content?.parts || [])
    .filter((part: any) => !part?.thought)
    .map((part: any) => part?.text)
    .filter((text: unknown): text is string => typeof text === 'string')
    .join('')
    .trim();
}

function extractTextFromSteps(steps: unknown) {
  const textParts = collectTextParts(steps);
  return textParts.join('').trim();
}

function collectTextParts(value: unknown, depth = 0, seen = new WeakSet<object>()): string[] {
  if (depth > MAX_RESPONSE_WALK_DEPTH) {
    return [];
  }

  if (typeof value === 'string') {
    return [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((entry) => collectTextParts(entry, depth + 1, seen));
  }

  if (!value || typeof value !== 'object') {
    return [];
  }

  if (seen.has(value)) {
    return [];
  }
  seen.add(value);

  const record = value as Record<string, unknown>;
  const directText = record.text;
  const nested = Object.entries(record)
    .filter(([key]) => key !== 'thought' && key !== 'text')
    .flatMap(([, entry]) => collectTextParts(entry, depth + 1, seen));

  if (typeof directText === 'string' && record.thought !== true) {
    return [directText, ...nested];
  }

  return nested;
}

function getInteractionId(response: any) {
  return typeof response?.id === 'string' ? response.id : '';
}

function extractCitations(response: any, answer: string, siteUrl: string): Citation[] {
  const citations = new Map<string, Citation>();
  const chunks = [
    ...extractGroundingChunks(response?.steps),
    ...(response?.candidates?.[0]?.groundingMetadata?.groundingChunks || []),
    ...(response?.candidates?.[0]?.grounding_metadata?.grounding_chunks || []),
  ];

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

function extractGroundingChunks(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown[] {
  if (depth > MAX_RESPONSE_WALK_DEPTH) {
    return [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((entry) => extractGroundingChunks(entry, depth + 1, seen));
  }

  if (!value || typeof value !== 'object') {
    return [];
  }

  if (seen.has(value)) {
    return [];
  }
  seen.add(value);

  const record = value as Record<string, unknown>;
  const metadata = record.groundingMetadata || record.grounding_metadata;
  const chunks = metadata && typeof metadata === 'object'
    ? (metadata as Record<string, unknown>).groundingChunks || (metadata as Record<string, unknown>).grounding_chunks
    : undefined;

  return [
    ...(Array.isArray(chunks) ? chunks : []),
    ...Object.values(record).flatMap((entry) => extractGroundingChunks(entry, depth + 1, seen)),
  ];
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
