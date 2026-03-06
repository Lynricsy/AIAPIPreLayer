import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createProxyHandler } from '../src/proxy.ts';
import type { AppConfig, ProcessorContext } from '../src/types/index.ts';

interface ReasoningPart {
  type: 'reasoning_encrypted';
  encrypted_content?: string;
}

interface ReasoningInputItem {
  type: 'reasoning';
  id: string;
  content: ReasoningPart[];
}

interface MessageInputItem {
  type: 'message';
  role: 'user';
  content: Array<{ type: 'input_text'; text: string }>;
}

interface ResponsesRequestBody {
  model: string;
  stream: boolean;
  input: Array<ReasoningInputItem | MessageInputItem>;
}

const TEST_CONFIG: AppConfig = {
  server: {
    port: 3456,
    host: '0.0.0.0',
    maxPayloadSize: '1mb',
  },
  processors: {
    image: {
      enabled: false,
      output: {
        format: 'webp',
        quality: 80,
        effort: 4,
      },
      resize: {
        maxWidth: 1024,
        maxHeight: 1024,
      },
    },
    encryptedReasoning: {
      enabled: true,
      maxRetries: 2,
      preambleTimeoutMs: 5000,
    },
    serviceTier: { enabled: true, value: 'priority' },
  },
  logging: {
    level: 'error',
    format: 'json',
  },
};

function bytes(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

function installFetchMock(handler: (req: Request) => Response | Promise<Response>): void {
  globalThis.fetch = (async (
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ): Promise<Response> => {
    let req: Request;
    if (input instanceof Request) {
      req = input;
    } else if (typeof input === 'string') {
      req = new Request(input, init);
    } else {
      req = new Request(input.toString(), init);
    }
    return handler(req);
  }) as typeof fetch;
}

function makeNoopPipeline(): { process(ctx: ProcessorContext): Promise<ProcessorContext> } {
  return {
    async process(ctx: ProcessorContext): Promise<ProcessorContext> {
      return ctx;
    },
  };
}

function createHandler(config: AppConfig = TEST_CONFIG): (req: Request) => Promise<Response> {
  return createProxyHandler(makeNoopPipeline(), config);
}

function makeSSEEvent(event: string, payload: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
}

function makeSSEFailureBody(id: string): string {
  return [
    makeSSEEvent('response.created', {
      type: 'response.created',
      response: { id, status: 'in_progress' },
    }),
    makeSSEEvent('response.in_progress', {
      type: 'response.in_progress',
      response: { id, status: 'in_progress' },
    }),
    makeSSEEvent('error', {
      type: 'error',
      code: null,
      message: `fast model preprocessing failure (${id})`,
    }),
    makeSSEEvent('response.failed', {
      type: 'response.failed',
      response: { id, status: 'failed' },
    }),
  ].join('');
}

function makeSSESuccessBody(id: string): string {
  return [
    makeSSEEvent('response.created', {
      type: 'response.created',
      response: { id, status: 'in_progress' },
    }),
    makeSSEEvent('response.in_progress', {
      type: 'response.in_progress',
      response: { id, status: 'in_progress' },
    }),
    makeSSEEvent('response.output_item.added', {
      type: 'response.output_item.added',
      item: { id: `item_${id}` },
    }),
    makeSSEEvent('response.content_part.added', {
      type: 'response.content_part.added',
      part: { type: 'text', text: 'ok' },
    }),
    makeSSEEvent('response.output_item.done', {
      type: 'response.output_item.done',
      item: { id: `item_${id}` },
    }),
    makeSSEEvent('response.completed', {
      type: 'response.completed',
      response: { id, status: 'completed' },
    }),
  ].join('');
}

function makeSSEFailureResponse(id: string): Response {
  return new Response(makeSSEFailureBody(id), {
    status: 200,
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
    },
  });
}

function makeSSESuccessResponse(id: string): Response {
  return new Response(makeSSESuccessBody(id), {
    status: 200,
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
    },
  });
}

function messageInput(text: string): MessageInputItem {
  return {
    type: 'message',
    role: 'user',
    content: [{ type: 'input_text', text }],
  };
}

function reasoningInput(id: string, encryptedContent?: string): ReasoningInputItem {
  return {
    type: 'reasoning',
    id,
    content: [
      encryptedContent
        ? { type: 'reasoning_encrypted', encrypted_content: encryptedContent }
        : { type: 'reasoning_encrypted' },
    ],
  };
}

function makeEncryptedRequestBody(): ResponsesRequestBody {
  return {
    model: 'o3',
    stream: true,
    input: [
      messageInput('hello'),
      reasoningInput('rs_1', 'ENC_FIRST'),
      messageInput('middle'),
      reasoningInput('rs_2', 'ENC_LAST'),
      messageInput('world'),
    ],
  };
}

function makeNonEncryptedRequestBody(): ResponsesRequestBody {
  return {
    model: 'o3',
    stream: true,
    input: [messageInput('hello'), reasoningInput('rs_1'), messageInput('world')],
  };
}

function makeProxyRequest(targetPath: string, body: unknown): Request {
  const bodyText = JSON.stringify(body);
  return new Request(`https://prelayer.local/${targetPath}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'content-length': String(bytes(bodyText)),
    },
    body: bodyText,
  });
}

function parseBody(text: string): ResponsesRequestBody {
  return JSON.parse(text) as ResponsesRequestBody;
}

function extractEncryptedContentValues(body: ResponsesRequestBody): Array<string | undefined> {
  return body.input
    .filter((item): item is ReasoningInputItem => item.type === 'reasoning')
    .map((item) => item.content[0]?.encrypted_content);
}

function atOrThrow<T>(items: T[], index: number, label: string): T {
  const value = items[index];
  if (value === undefined) {
    throw new Error(`${label}[${index}] is undefined`);
  }
  return value;
}

describe('proxy SSE interceptor retry integration', () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('Scenario 1a: openai-chat requests are not intercepted', async () => {
    const forwardedUrls: string[] = [];
    const upstreamFailure = makeSSEFailureBody('chat-no-retry');

    installFetchMock((req) => {
      forwardedUrls.push(req.url);
      return makeSSEFailureResponse('chat-no-retry');
    });

    const handler = createHandler();
    const response = await handler(
      makeProxyRequest('api.openai.com/v1/chat/completions', makeEncryptedRequestBody()),
    );

    expect(forwardedUrls.length).toBe(1);
    expect(forwardedUrls[0]).toBe('https://api.openai.com/v1/chat/completions');
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(upstreamFailure);
  });

  test('Scenario 1b: openai-responses without encrypted_content are not intercepted', async () => {
    const forwardedBodies: ResponsesRequestBody[] = [];

    installFetchMock(async (req) => {
      forwardedBodies.push(parseBody(await req.text()));
      return makeSSEFailureResponse('responses-no-encrypted');
    });

    const handler = createHandler();
    const response = await handler(makeProxyRequest('api.openai.com/v1/responses', makeNonEncryptedRequestBody()));

    expect(forwardedBodies.length).toBe(1);
    expect(extractEncryptedContentValues(atOrThrow(forwardedBodies, 0, 'forwardedBodies'))).toEqual([
      undefined,
    ]);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('responses-no-encrypted');
  });

  test('Scenario 1c: encryptedReasoning disabled means no interception', async () => {
    const forwardedBodies: ResponsesRequestBody[] = [];

    installFetchMock(async (req) => {
      forwardedBodies.push(parseBody(await req.text()));
      return makeSSEFailureResponse('disabled-no-retry');
    });

    const disabledConfig: AppConfig = {
      ...TEST_CONFIG,
      processors: {
        ...TEST_CONFIG.processors,
        encryptedReasoning: {
          ...TEST_CONFIG.processors.encryptedReasoning,
          enabled: false,
        },
      },
    };

    const handler = createHandler(disabledConfig);
    const response = await handler(makeProxyRequest('api.openai.com/v1/responses', makeEncryptedRequestBody()));

    expect(forwardedBodies.length).toBe(1);
    expect(extractEncryptedContentValues(atOrThrow(forwardedBodies, 0, 'forwardedBodies'))).toEqual([
      'ENC_FIRST',
      'ENC_LAST',
    ]);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('disabled-no-retry');
  });

  test('Scenario 2: first attempt succeeds without retry', async () => {
    const forwardedBodies: ResponsesRequestBody[] = [];

    installFetchMock(async (req) => {
      forwardedBodies.push(parseBody(await req.text()));
      return makeSSESuccessResponse('resp-success-1');
    });

    const handler = createHandler();
    const response = await handler(makeProxyRequest('api.openai.com/v1/responses', makeEncryptedRequestBody()));
    const responseText = await response.text();

    expect(forwardedBodies.length).toBe(1);
    expect(extractEncryptedContentValues(atOrThrow(forwardedBodies, 0, 'forwardedBodies'))).toEqual([
      'ENC_FIRST',
      'ENC_LAST',
    ]);
    expect(response.status).toBe(200);
    expect(responseText).toContain('event: response.output_item.added');
    expect(responseText).toContain('"status":"completed"');
  });

  test('Scenario 3: drop-last retry succeeds on second attempt', async () => {
    const forwardedBodies: ResponsesRequestBody[] = [];

    installFetchMock(async (req) => {
      forwardedBodies.push(parseBody(await req.text()));
      if (forwardedBodies.length === 1) {
        return makeSSEFailureResponse('resp-fail-1');
      }
      if (forwardedBodies.length === 2) {
        return makeSSESuccessResponse('resp-success-2');
      }
      throw new Error('unexpected extra retry');
    });

    const handler = createHandler();
    const response = await handler(makeProxyRequest('api.openai.com/v1/responses', makeEncryptedRequestBody()));
    const responseText = await response.text();

    expect(forwardedBodies.length).toBe(2);
    expect(extractEncryptedContentValues(atOrThrow(forwardedBodies, 0, 'forwardedBodies'))).toEqual([
      'ENC_FIRST',
      'ENC_LAST',
    ]);
    expect(extractEncryptedContentValues(atOrThrow(forwardedBodies, 1, 'forwardedBodies'))).toEqual([
      'ENC_FIRST',
      undefined,
    ]);
    expect(response.status).toBe(200);
    expect(responseText).toContain('resp-success-2');
  });

  test('Scenario 4: drop-all retry succeeds on third attempt', async () => {
    const forwardedBodies: ResponsesRequestBody[] = [];

    installFetchMock(async (req) => {
      forwardedBodies.push(parseBody(await req.text()));
      if (forwardedBodies.length <= 2) {
        return makeSSEFailureResponse(`resp-fail-${forwardedBodies.length}`);
      }
      if (forwardedBodies.length === 3) {
        return makeSSESuccessResponse('resp-success-3');
      }
      throw new Error('unexpected extra retry');
    });

    const handler = createHandler();
    const response = await handler(makeProxyRequest('api.openai.com/v1/responses', makeEncryptedRequestBody()));
    const responseText = await response.text();

    expect(forwardedBodies.length).toBe(3);
    expect(extractEncryptedContentValues(atOrThrow(forwardedBodies, 0, 'forwardedBodies'))).toEqual([
      'ENC_FIRST',
      'ENC_LAST',
    ]);
    expect(extractEncryptedContentValues(atOrThrow(forwardedBodies, 1, 'forwardedBodies'))).toEqual([
      'ENC_FIRST',
      undefined,
    ]);
    expect(extractEncryptedContentValues(atOrThrow(forwardedBodies, 2, 'forwardedBodies'))).toEqual([
      undefined,
      undefined,
    ]);
    expect(response.status).toBe(200);
    expect(responseText).toContain('resp-success-3');
  });

  test('Scenario 5: all retries exhausted returns final failure response', async () => {
    const forwardedBodies: ResponsesRequestBody[] = [];

    installFetchMock(async (req) => {
      forwardedBodies.push(parseBody(await req.text()));
      return makeSSEFailureResponse(`resp-fail-${forwardedBodies.length}`);
    });

    const handler = createHandler();
    const response = await handler(makeProxyRequest('api.openai.com/v1/responses', makeEncryptedRequestBody()));
    const responseText = await response.text();

    expect(forwardedBodies.length).toBe(3);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(responseText).toContain('event: response.failed');
    expect(responseText).toContain('resp-fail-3');
    expect(responseText).not.toContain('resp-fail-1');
  });
});
