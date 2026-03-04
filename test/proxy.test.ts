import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createProxyHandler } from '../src/proxy.ts';
import type { AppConfig, ProcessorContext } from '../src/types/index.ts';

const TEST_CONFIG: AppConfig = {
  server: {
    port: 3000,
    host: '0.0.0.0',
    maxPayloadSize: '50mb',
  },
  processors: {
    image: {
      enabled: true,
      output: {
        format: 'webp',
        quality: 80,
        effort: 4,
      },
      resize: {
        maxWidth: 2048,
        maxHeight: 2048,
      },
    },
    encryptedReasoning: {
      enabled: true,
      maxRetries: 2,
      preambleTimeoutMs: 5000,
    },
  },
  logging: {
    level: 'info',
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

describe('createProxyHandler', () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('POST body modification and Content-Length byte recalculation', async () => {
    const capture: { req: Request | null; ctx: ProcessorContext | null } = {
      req: null,
      ctx: null,
    };

    installFetchMock(async (req) => {
      capture.req = req;
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    const pipeline = {
      async process(ctx: ProcessorContext): Promise<ProcessorContext> {
        capture.ctx = ctx;
        return {
          ...ctx,
          requestBody: {
            ...(ctx.requestBody as Record<string, unknown>),
            transformed: '喵',
          },
        };
      },
    };

    const handler = createProxyHandler(pipeline, TEST_CONFIG);
    const originalBody = JSON.stringify({ message: 'hello' });

    const response = await handler(
      new Request('https://prelayer.local/api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': String(bytes(originalBody)),
          host: 'prelayer.local',
        },
        body: originalBody,
      }),
    );

    expect(response.status).toBe(200);
    const pipelineCtx = capture.ctx;
    if (pipelineCtx === null) {
      throw new Error('pipeline was not called');
    }
    expect(pipelineCtx.apiFormat).toBe('openai-chat');

    const forwardedReq = capture.req;
    if (forwardedReq === null) {
      throw new Error('fetch was not called');
    }

    expect(forwardedReq.url).toBe('https://api.openai.com/v1/chat/completions');
    expect(forwardedReq.headers.get('host')).toBeNull();

    const forwardedBody = await forwardedReq.text();
    const expectedBody = JSON.stringify({ message: 'hello', transformed: '喵' });
    expect(forwardedBody).toBe(expectedBody);
    expect(forwardedReq.headers.get('content-length')).toBe(String(bytes(expectedBody)));
  });

  test('GET request passthrough without pipeline processing', async () => {
    let called = false;
    let capturedUrl = '';

    installFetchMock((req) => {
      capturedUrl = req.url;
      return new Response('ok', { status: 200 });
    });

    const pipeline = {
      async process(ctx: ProcessorContext): Promise<ProcessorContext> {
        called = true;
        return ctx;
      },
    };

    const handler = createProxyHandler(pipeline, TEST_CONFIG);
    const response = await handler(
      new Request('https://prelayer.local/api.anthropic.com/v1/messages?stream=true', {
        method: 'GET',
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('ok');
    expect(called).toBe(false);
    expect(capturedUrl).toBe('https://api.anthropic.com/v1/messages?stream=true');
  });

  test('payload too large returns 413', async () => {
    let fetchCalled = false;

    installFetchMock(() => {
      fetchCalled = true;
      return new Response('unexpected', { status: 500 });
    });

    const pipeline = {
      async process(ctx: ProcessorContext): Promise<ProcessorContext> {
        return ctx;
      },
    };

    const handler = createProxyHandler(pipeline, {
      ...TEST_CONFIG,
      server: {
        ...TEST_CONFIG.server,
        maxPayloadSize: '10b',
      },
    });

    const response = await handler(
      new Request('https://prelayer.local/api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': '100',
        },
        body: '{"x":1}',
      }),
    );

    expect(response.status).toBe(413);
    expect(fetchCalled).toBe(false);
    const payload = (await response.json()) as { error?: string };
    expect(payload.error).toContain('exceeds maximum');
  });

  test('non-JSON body passthrough without processor call', async () => {
    let called = false;
    let forwardedBody = '';
    let forwardedLength = '';

    installFetchMock(async (req) => {
      forwardedBody = await req.text();
      forwardedLength = req.headers.get('content-length') ?? '';
      return new Response('ok');
    });

    const pipeline = {
      async process(ctx: ProcessorContext): Promise<ProcessorContext> {
        called = true;
        return ctx;
      },
    };

    const handler = createProxyHandler(pipeline, TEST_CONFIG);
    const body = 'plain=text&value=42';
    const response = await handler(
      new Request('https://prelayer.local/api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'content-length': String(bytes(body)),
        },
        body,
      }),
    );

    expect(response.status).toBe(200);
    expect(called).toBe(false);
    expect(forwardedBody).toBe(body);
    expect(forwardedLength).toBe(String(bytes(body)));
  });

  test('invalid routing returns 400', async () => {
    let fetchCalled = false;

    installFetchMock(() => {
      fetchCalled = true;
      return new Response('unexpected', { status: 500 });
    });

    const pipeline = {
      async process(ctx: ProcessorContext): Promise<ProcessorContext> {
        return ctx;
      },
    };

    const handler = createProxyHandler(pipeline, TEST_CONFIG);
    const response = await handler(
      new Request('https://prelayer.local/localhost/v1/chat/completions', { method: 'GET' }),
    );

    expect(response.status).toBe(400);
    expect(fetchCalled).toBe(false);
    const payload = (await response.json()) as { error?: string };
    expect(payload.error).toContain('Routing error');
  });

  test('SSE response stream passthrough', async () => {
    const chunks = ['data: one\n\n', 'data: two\n\n'];
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(chunks[0]!));
        controller.enqueue(new TextEncoder().encode(chunks[1]!));
        controller.close();
      },
    });

    installFetchMock(() => {
      return new Response(stream, {
        status: 200,
        headers: {
          'content-type': 'text/event-stream',
        },
      });
    });

    const pipeline = {
      async process(ctx: ProcessorContext): Promise<ProcessorContext> {
        return ctx;
      },
    };

    const handler = createProxyHandler(pipeline, TEST_CONFIG);
    const response = await handler(
      new Request('https://prelayer.local/api.openai.com/v1/chat/completions?stream=true', {
        method: 'GET',
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(await response.text()).toBe(chunks.join(''));
  });
});
