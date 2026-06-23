import assert from 'node:assert/strict';
import test from 'node:test';
import {
  askGeminiSearch,
  createGeminiSearch,
  GeminiSearchError,
  streamGeminiSearch,
  validateGeminiSearchInput,
} from '../dist/core.js';
import {createGeminiSearchFetchHandler} from '../dist/fetch.js';

test('validateGeminiSearchInput rejects invalid input', () => {
  assert.throws(
    () => validateGeminiSearchInput(''),
    (error) => error instanceof GeminiSearchError
      && error.code === 'missing_question'
      && error.statusCode === 400,
  );

  assert.throws(
    () => validateGeminiSearchInput('question', '../bad id'),
    (error) => error instanceof GeminiSearchError
      && error.code === 'invalid_interaction_id'
      && error.statusCode === 400,
  );

  assert.doesNotThrow(() => validateGeminiSearchInput('question'));
  assert.doesNotThrow(() => validateGeminiSearchInput('question', 'interaction-abc-123:xyz'));
});

test('askGeminiSearch creates a first interaction without previous interaction id', async () => {
  const calls = [];
  const result = await askGeminiSearch({
    apiKey: 'test-key',
    fileSearchStoreName: 'fileSearchStores/docs',
    client: {
      interactions: {
        async create(input) {
          calls.push(input);
          return {
            id: 'interaction-1',
            output_text: 'Install with npm.',
            steps: [
              {
                groundingMetadata: {
                  groundingChunks: [
                    {
                      retrievedContext: {
                        title: 'Setup',
                        uri: 'https://docs.example.com/setup',
                        text: 'npm install',
                      },
                    },
                  ],
                },
              },
            ],
          };
        },
      },
    },
  }, {
    question: 'How do I install this?',
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].model, 'gemini-3.1-flash-lite');
  assert.equal(calls[0].input, 'How do I install this?');
  assert.equal(calls[0].store, true);
  assert.equal(calls[0].previous_interaction_id, undefined);
  assert.deepEqual(calls[0].tools, [{
    type: 'file_search',
    file_search_store_names: ['fileSearchStores/docs'],
  }]);
  assert.deepEqual(calls[0].generation_config, {
    temperature: 0,
    max_output_tokens: 1200,
  });
  assert.equal(result.answer, 'Install with npm.');
  assert.equal(result.interactionId, 'interaction-1');
  assert.deepEqual(result.citations, [{
    title: 'Setup',
    url: 'https://docs.example.com/setup',
    sourcePath: undefined,
    snippet: 'npm install',
  }]);
});

test('askGeminiSearch passes previous interaction id on follow-up turns', async () => {
  const calls = [];
  const result = await askGeminiSearch({
    apiKey: 'test-key',
    fileSearchStoreName: 'fileSearchStores/docs',
    client: {
      interactions: {
        async create(input) {
          calls.push(input);
          return {
            id: 'interaction-2',
            output_text: 'Use the same install command.',
          };
        },
      },
    },
  }, {
    previousInteractionId: 'interaction-1',
    question: 'What about pnpm?',
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].previous_interaction_id, 'interaction-1');
  assert.equal(result.interactionId, 'interaction-2');
});

test('streamGeminiSearch yields text deltas and final citations', async () => {
  const calls = [];
  async function* streamEvents() {
    yield {
      event_type: 'interaction.created',
      interaction: {id: 'interaction-stream', status: 'in_progress'},
    };
    yield {
      event_type: 'step.delta',
      delta: {type: 'text', text: 'Install '},
    };
    yield {
      event_type: 'step.delta',
      delta: {type: 'text', text: 'with npm.'},
    };
    yield {
      event_type: 'interaction.completed',
      interaction: {
        id: 'interaction-stream',
        status: 'completed',
        steps: [
          {
            groundingMetadata: {
              groundingChunks: [
                {
                  retrievedContext: {
                    title: 'Setup',
                    uri: 'https://docs.example.com/setup',
                    text: 'npm install',
                  },
                },
              ],
            },
          },
        ],
      },
    };
  }

  const events = [];
  for await (const event of streamGeminiSearch({
    apiKey: 'test-key',
    fileSearchStoreName: 'fileSearchStores/docs',
    client: {
      interactions: {
        async create(input) {
          calls.push(input);
          return streamEvents();
        },
      },
    },
  }, {
    question: 'How do I install this?',
  })) {
    events.push(event);
  }

  assert.equal(calls.length, 1);
  assert.equal(calls[0].stream, true);
  assert.equal(calls[0].store, true);
  assert.deepEqual(events, [
    {type: 'delta', text: 'Install '},
    {type: 'delta', text: 'with npm.'},
    {
      type: 'done',
      answer: 'Install with npm.',
      citations: [{
        title: 'Setup',
        url: 'https://docs.example.com/setup',
        sourcePath: undefined,
        snippet: 'npm install',
      }],
      interactionId: 'interaction-stream',
    },
  ]);
});

test('createGeminiSearch reuses the configured client across asks', async () => {
  let count = 0;
  const geminiSearch = createGeminiSearch({
    apiKey: 'test-key',
    fileSearchStoreName: 'fileSearchStores/docs',
    client: {
      interactions: {
        async create() {
          count++;
          return {
            id: `interaction-${count}`,
            output_text: `Answer ${count}.`,
          };
        },
      },
    },
  });

  const first = await geminiSearch.ask({question: 'First?'});
  const second = await geminiSearch.ask({question: 'Second?', previousInteractionId: first.interactionId});

  assert.equal(count, 2);
  assert.equal(first.interactionId, 'interaction-1');
  assert.equal(second.interactionId, 'interaction-2');
});

test('response walkers tolerate cyclic structures', async () => {
  const cyclicStep = {text: 'Safe answer.'};
  cyclicStep.self = cyclicStep;

  const result = await askGeminiSearch({
    apiKey: 'test-key',
    fileSearchStoreName: 'fileSearchStores/docs',
    client: {
      interactions: {
        async create() {
          return {
            id: 'interaction-cycle',
            steps: [cyclicStep],
          };
        },
      },
    },
  }, {
    question: 'Can cycles break this?',
  });

  assert.equal(result.answer, 'Safe answer.');
});

test('fetch handler rejects invalid origins', async () => {
  const handler = createGeminiSearchFetchHandler({allowedOrigins: ['https://docs.example.com']});
  const response = await handler(new Request('https://api.example.com/api/gemini-search', {
    method: 'POST',
    headers: {
      origin: 'https://evil.example.com',
    },
    body: '{}',
  }));

  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), {error: 'Origin is not allowed'});
});

test('fetch handler rejects invalid JSON', async () => {
  const handler = createGeminiSearchFetchHandler();
  const response = await handler(new Request('https://docs.example.com/api/gemini-search', {
    method: 'POST',
    body: 'not json',
  }));

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {error: 'Invalid JSON body'});
});

test('fetch handler rejects invalid previous interaction id', async () => {
  const handler = createGeminiSearchFetchHandler();
  const response = await handler(new Request('https://docs.example.com/api/gemini-search', {
    method: 'POST',
    body: JSON.stringify({
      previousInteractionId: '../bad id',
      question: 'How do I install this?',
    }),
  }));

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {error: 'Interaction ID is invalid'});
});

test('fetch handler returns access-denied responses from checkAccess', async () => {
  let accessContext;
  const handler = createGeminiSearchFetchHandler({
    checkAccess(context) {
      accessContext = context;
      return {
        allowed: false,
        statusCode: 429,
        error: 'Rate limited',
        headers: {'Retry-After': '60'},
      };
    },
  });
  const response = await handler(new Request('https://docs.example.com/api/gemini-search', {
    method: 'POST',
    body: JSON.stringify({
      previousInteractionId: 'interaction-1',
      question: 'How do I install this?',
    }),
  }));

  assert.equal(response.status, 429);
  assert.equal(response.headers.get('Retry-After'), '60');
  assert.equal(accessContext.previousInteractionId, 'interaction-1');
  assert.equal(accessContext.question, 'How do I install this?');
  assert.deepEqual(await response.json(), {error: 'Rate limited'});
});

test('fetch handler passes previous interaction id and returns interaction id', async () => {
  const handler = createGeminiSearchFetchHandler({
    apiKey: 'test-key',
    fileSearchStoreName: 'fileSearchStores/docs',
    client: {
      interactions: {
        async create(input) {
          assert.equal(input.previous_interaction_id, 'interaction-1');
          return {
            id: 'interaction-2',
            output_text: 'Follow-up answer.',
          };
        },
      },
    },
  });
  const response = await handler(new Request('https://docs.example.com/api/gemini-search', {
    method: 'POST',
    body: JSON.stringify({
      previousInteractionId: 'interaction-1',
      question: 'Can you clarify?',
    }),
  }));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    answer: 'Follow-up answer.',
    citations: [],
    interactionId: 'interaction-2',
  });
});

test('fetch handler streams SSE when stream option is enabled', async () => {
  async function* streamEvents() {
    yield {
      event_type: 'interaction.created',
      interaction: {id: 'interaction-stream', status: 'in_progress'},
    };
    yield {
      event_type: 'step.delta',
      delta: {type: 'text', text: 'First '},
    };
    yield {
      event_type: 'step.delta',
      delta: {type: 'text', text: 'chunk.'},
    };
    yield {
      event_type: 'interaction.completed',
      interaction: {id: 'interaction-stream', status: 'completed'},
    };
  }

  const handler = createGeminiSearchFetchHandler({
    apiKey: 'test-key',
    fileSearchStoreName: 'fileSearchStores/docs',
    stream: true,
    client: {
      interactions: {
        async create(input) {
          assert.equal(input.stream, true);
          assert.equal(input.previous_interaction_id, 'interaction-1');
          return streamEvents();
        },
      },
    },
  });
  const response = await handler(new Request('https://docs.example.com/api/gemini-search', {
    method: 'POST',
    body: JSON.stringify({
      previousInteractionId: 'interaction-1',
      question: 'Can you stream?',
    }),
  }));

  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/event-stream/);
  const events = parseSseEvents(await response.text());
  assert.deepEqual(events, [
    {event: 'delta', data: {type: 'delta', text: 'First '}},
    {event: 'delta', data: {type: 'delta', text: 'chunk.'}},
    {
      event: 'done',
      data: {
        type: 'done',
        answer: 'First chunk.',
        citations: [],
        interactionId: 'interaction-stream',
      },
    },
  ]);
});

test('fetch handler sends SSE error events when Gemini stream fails', async () => {
  const originalConsoleError = console.error;
  console.error = () => {};
  async function* streamEvents() {
    yield {
      event_type: 'error',
      error: {message: 'Stream failed'},
    };
  }

  try {
    const handler = createGeminiSearchFetchHandler({
      apiKey: 'test-key',
      fileSearchStoreName: 'fileSearchStores/docs',
      stream: true,
      client: {
        interactions: {
          async create() {
            return streamEvents();
          },
        },
      },
    });
    const response = await handler(new Request('https://docs.example.com/api/gemini-search', {
      method: 'POST',
      body: JSON.stringify({
        question: 'Can you stream?',
      }),
    }));

    assert.equal(response.status, 200);
    assert.deepEqual(parseSseEvents(await response.text()), [
      {event: 'error', data: {error: 'Failed to generate an answer'}},
    ]);
  } finally {
    console.error = originalConsoleError;
  }
});

test('fetch handler maps missing Gemini configuration without calling Gemini', async () => {
  const originalApiKey = process.env.GEMINI_API_KEY;
  const originalStoreName = process.env.GEMINI_FILE_SEARCH_STORE_NAME;
  delete process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_FILE_SEARCH_STORE_NAME;

  try {
    const handler = createGeminiSearchFetchHandler();
    const response = await handler(new Request('https://docs.example.com/api/gemini-search', {
      method: 'POST',
      body: JSON.stringify({
        question: 'How do I install this?',
      }),
    }));

    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), {error: 'Gemini Search is not configured'});
  } finally {
    if (originalApiKey === undefined) {
      delete process.env.GEMINI_API_KEY;
    } else {
      process.env.GEMINI_API_KEY = originalApiKey;
    }

    if (originalStoreName === undefined) {
      delete process.env.GEMINI_FILE_SEARCH_STORE_NAME;
    } else {
      process.env.GEMINI_FILE_SEARCH_STORE_NAME = originalStoreName;
    }
  }
});

function parseSseEvents(text) {
  return text.trim().split(/\n\n/).map((message) => {
    const lines = message.split(/\n/);
    const event = lines.find((line) => line.startsWith('event:'))?.slice('event:'.length).trim();
    const data = lines
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice('data:'.length).trimStart())
      .join('\n');
    return {event, data: JSON.parse(data)};
  });
}
