import { afterEach, describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { DEFAULT_CONFIG } from '../src/config.ts';
import { createProxyHandler } from '../src/proxy.ts';
import { createProcessorRegistry } from '../src/registry.ts';
import type { AppConfig } from '../src/types/index.ts';
import { detectMimeType, parseDataUri } from '../src/utils/base64.ts';

type JsonRecord = Record<string, unknown>;

type AnthropicSequenceEntry =
  | {
      kind: 'text';
      text: string;
    }
  | {
      kind: 'image';
      data: string;
      mediaType: string;
    };

interface CapturedRequest {
  method: string;
  path: string;
  search: string;
  headers: Headers;
  rawBody: string;
}

type TargetResponder = (captured: CapturedRequest) => Response | Promise<Response>;

interface MockTargetServer {
  port: number;
  requests: CapturedRequest[];
  setResponder(responder: TargetResponder): void;
  stop(): void;
}

interface ProxyServer {
  port: number;
  stop(): void;
}

const FIXTURE_ROOT = new URL('./fixtures/', import.meta.url);
const LOCAL_UPSTREAM_HOSTS = new Set([
  'api.openai.com',
  'api.anthropic.com',
  'generativelanguage.googleapis.com',
]);

const cleanups: Array<() => void> = [];

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null;
}

function expectRecord(value: unknown, label: string): JsonRecord {
  if (!isRecord(value)) {
    throw new Error(`${label} 必须是对象`);
  }
  return value;
}

function expectArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} 必须是数组`);
  }
  return value;
}

function expectIndex<T>(items: T[], index: number, label: string): T {
  const value = items[index];
  if (value === undefined) {
    throw new Error(`${label}[${index}] 不存在`);
  }
  return value;
}

function parseJson(text: string, label: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${label} 不是合法 JSON: ${message}`);
  }
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

async function loadFixtureJson(name: string): Promise<unknown> {
  const text = await Bun.file(new URL(name, FIXTURE_ROOT)).text();
  return parseJson(text, `fixture:${name}`);
}

function createTestConfig(imageEnabled = true): AppConfig {
  return {
    server: {
      ...DEFAULT_CONFIG.server,
    },
    processors: {
      image: {
        ...DEFAULT_CONFIG.processors.image,
        enabled: imageEnabled,
        output: {
          ...DEFAULT_CONFIG.processors.image.output,
        },
        resize: {
          ...DEFAULT_CONFIG.processors.image.resize,
        },
      },
      encryptedReasoning: {
        ...DEFAULT_CONFIG.processors.encryptedReasoning,
      },
    },
    logging: {
      ...DEFAULT_CONFIG.logging,
    },
  };
}

function createJsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json',
    },
  });
}

function createSseResponse(chunks: string[]): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
    },
  });
}

function resolveServerPort(port: number | undefined, label: string): number {
  if (port === undefined) {
    throw new Error(`${label} 未分配可用端口`);
  }
  return port;
}

function createMockTargetServer(): MockTargetServer {
  const app = new Hono();
  const requests: CapturedRequest[] = [];

  let responder: TargetResponder = () =>
    createJsonResponse({
      ok: true,
      source: 'mock-target',
    });

  app.all('/*', async (c) => {
    const rawRequest = c.req.raw;
    const url = new URL(rawRequest.url);
    const rawBody = await rawRequest.text();

    const captured: CapturedRequest = {
      method: rawRequest.method,
      path: url.pathname,
      search: url.search,
      headers: new Headers(rawRequest.headers),
      rawBody,
    };

    requests.push(captured);
    return responder(captured);
  });

  const server = Bun.serve({
    port: 0,
    fetch: app.fetch,
  });

  return {
    port: resolveServerPort(server.port, 'mock-target'),
    requests,
    setResponder(next) {
      responder = next;
    },
    stop() {
      server.stop(true);
    },
  };
}

function createProxyServer(config: AppConfig): ProxyServer {
  const pipeline = createProcessorRegistry(config);
  const proxyHandler = createProxyHandler(pipeline, config);

  const app = new Hono();
  app.all('/*', (c) => proxyHandler(c.req.raw));

  const server = Bun.serve({
    port: 0,
    fetch: app.fetch,
  });

  return {
    port: resolveServerPort(server.port, 'proxy'),
    stop() {
      server.stop(true);
    },
  };
}

function installUpstreamRedirect(targetPort: number): () => void {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ): Promise<Response> => {
    const request =
      input instanceof Request
        ? input
        : new Request(typeof input === 'string' ? input : input.toString(), init);
    const url = new URL(request.url);

    if (LOCAL_UPSTREAM_HOSTS.has(url.hostname)) {
      const redirectedUrl = `http://127.0.0.1:${targetPort}${url.pathname}${url.search}`;
      const redirectedRequest = new Request(redirectedUrl, request);
      return originalFetch(redirectedRequest);
    }

    if (input instanceof Request) {
      return originalFetch(input);
    }
    if (typeof input === 'string') {
      return originalFetch(input, init);
    }
    return originalFetch(input.toString(), init);
  }) as typeof fetch;

  return () => {
    globalThis.fetch = originalFetch;
  };
}

function setupE2E(imageEnabled = true): {
  mockTarget: MockTargetServer;
  proxy: ProxyServer;
  cleanup: () => void;
} {
  const mockTarget = createMockTargetServer();
  const restoreFetch = installUpstreamRedirect(mockTarget.port);
  const proxy = createProxyServer(createTestConfig(imageEnabled));

  const cleanup = () => {
    restoreFetch();
    proxy.stop();
    mockTarget.stop();
  };

  return { mockTarget, proxy, cleanup };
}

function buildProxyUrl(proxyPort: number, targetHost: string, targetPath: string): string {
  const normalizedPath = targetPath.startsWith('/') ? targetPath : `/${targetPath}`;
  return `http://127.0.0.1:${proxyPort}/${targetHost}${normalizedPath}`;
}

function getLastRequest(requests: CapturedRequest[]): CapturedRequest {
  const request = requests[requests.length - 1];
  if (request === undefined) {
    throw new Error('mock 目标服务没有收到请求');
  }
  return request;
}

function collectOpenAIChatSnapshot(payload: unknown): {
  imageUrls: string[];
  textBlocks: string[];
} {
  const root = expectRecord(payload, 'openai-chat payload');
  const messages = expectArray(root['messages'], 'openai-chat.messages');
  const imageUrls: string[] = [];
  const textBlocks: string[] = [];

  const walkContent = (content: unknown): void => {
    if (!Array.isArray(content)) {
      return;
    }

    for (const part of content) {
      if (!isRecord(part)) {
        continue;
      }

      if (part['type'] === 'text' && typeof part['text'] === 'string') {
        textBlocks.push(part['text']);
      }

      if (part['type'] === 'image_url') {
        const imageUrl = part['image_url'];
        if (isRecord(imageUrl) && typeof imageUrl['url'] === 'string') {
          imageUrls.push(imageUrl['url']);
        }
      }

      walkContent(part['content']);

      const functionResponse = part['functionResponse'];
      if (isRecord(functionResponse)) {
        const response = functionResponse['response'];
        if (isRecord(response)) {
          walkContent(response['content']);
        }
      }

      const response = part['response'];
      if (isRecord(response)) {
        walkContent(response['content']);
      }
    }
  };

  for (const message of messages) {
    if (!isRecord(message)) {
      continue;
    }

    const content = message['content'];
    if (typeof content === 'string') {
      textBlocks.push(content);
    }
    walkContent(content);
  }

  return { imageUrls, textBlocks };
}

function collectOpenAIResponsesSnapshot(payload: unknown): {
  imageUrls: string[];
  textBlocks: string[];
} {
  const root = expectRecord(payload, 'openai-responses payload');
  const input = expectArray(root['input'], 'openai-responses.input');
  const imageUrls: string[] = [];
  const textBlocks: string[] = [];

  const walkContent = (content: unknown): void => {
    if (!Array.isArray(content)) {
      return;
    }

    for (const part of content) {
      if (!isRecord(part)) {
        continue;
      }

      const partType = part['type'];
      if ((partType === 'input_text' || partType === 'output_text') && typeof part['text'] === 'string') {
        textBlocks.push(part['text']);
      }

      if (partType === 'input_image' && typeof part['image_url'] === 'string') {
        imageUrls.push(part['image_url']);
      }

      walkContent(part['content']);

      const functionResponse = part['functionResponse'];
      if (isRecord(functionResponse)) {
        const response = functionResponse['response'];
        if (isRecord(response)) {
          walkContent(response['content']);
        }
      }

      const response = part['response'];
      if (isRecord(response)) {
        walkContent(response['content']);
      }
    }
  };

  for (const item of input) {
    if (!isRecord(item)) {
      continue;
    }

    walkContent(item['content']);
  }

  return { imageUrls, textBlocks };
}

function collectAnthropicSequence(payload: unknown): AnthropicSequenceEntry[] {
  const root = expectRecord(payload, 'anthropic payload');
  const messages = expectArray(root['messages'], 'anthropic.messages');
  const sequence: AnthropicSequenceEntry[] = [];

  const walkContent = (content: unknown): void => {
    if (!Array.isArray(content)) {
      return;
    }

    for (const part of content) {
      if (!isRecord(part)) {
        continue;
      }

      if (part['type'] === 'text' && typeof part['text'] === 'string') {
        sequence.push({ kind: 'text', text: part['text'] });
      }

      if (part['type'] === 'image') {
        const source = part['source'];
        if (
          isRecord(source) &&
          typeof source['data'] === 'string' &&
          typeof source['media_type'] === 'string'
        ) {
          sequence.push({
            kind: 'image',
            data: source['data'],
            mediaType: source['media_type'],
          });
        }
      }

      walkContent(part['content']);

      const response = part['response'];
      if (isRecord(response)) {
        walkContent(response['content']);
      }
    }
  };

  for (const message of messages) {
    if (!isRecord(message)) {
      continue;
    }

    walkContent(message['content']);
  }

  return sequence;
}

function collectGeminiInlineData(payload: unknown): Array<{ data: string; mimeType: string }> {
  const root = expectRecord(payload, 'gemini payload');
  const contents = expectArray(root['contents'], 'gemini.contents');
  const inlineData: Array<{ data: string; mimeType: string }> = [];

  const walkParts = (parts: unknown): void => {
    if (!Array.isArray(parts)) {
      return;
    }

    for (const part of parts) {
      if (!isRecord(part)) {
        continue;
      }

      const inline = part['inlineData'];
      if (isRecord(inline) && typeof inline['data'] === 'string' && typeof inline['mimeType'] === 'string') {
        inlineData.push({
          data: inline['data'],
          mimeType: inline['mimeType'],
        });
      }

      walkParts(part['parts']);
      walkParts(part['content']);

      const functionResponse = part['functionResponse'];
      if (isRecord(functionResponse)) {
        const response = functionResponse['response'];
        if (isRecord(response)) {
          walkParts(response['content']);
        }
      }

      const response = part['response'];
      if (isRecord(response)) {
        walkParts(response['content']);
      }
    }
  };

  for (const content of contents) {
    if (!isRecord(content)) {
      continue;
    }
    walkParts(content['parts']);
  }

  return inlineData;
}

function isTextEntry(entry: AnthropicSequenceEntry): entry is { kind: 'text'; text: string } {
  return entry.kind === 'text';
}

function isImageEntry(
  entry: AnthropicSequenceEntry,
): entry is { kind: 'image'; data: string; mediaType: string } {
  return entry.kind === 'image';
}

function assertDataUriWebP(dataUri: string): void {
  const parsed = parseDataUri(dataUri);
  expect(parsed).not.toBeNull();
  if (parsed === null) {
    throw new Error('不是合法 Data URI');
  }

  expect(parsed.mimeType).toBe('image/webp');
  expect(detectMimeType(parsed.base64Data)).toBe('image/webp');
}

function assertRawBase64WebP(base64Data: string): void {
  expect(detectMimeType(base64Data)).toBe('image/webp');
}

function replaceAllOpenAIResponsesImages(payload: unknown, imageUrl: string): string {
  const root = expectRecord(payload, 'openai-responses payload');
  const input = expectArray(root['input'], 'openai-responses.input');
  let replaced = 0;

  const walkContent = (content: unknown): void => {
    if (!Array.isArray(content)) {
      return;
    }

    for (const part of content) {
      if (!isRecord(part)) {
        continue;
      }

      if (part['type'] === 'input_image' && typeof part['image_url'] === 'string') {
        part['image_url'] = imageUrl;
        replaced += 1;
      }

      walkContent(part['content']);

      const functionResponse = part['functionResponse'];
      if (isRecord(functionResponse)) {
        const response = functionResponse['response'];
        if (isRecord(response)) {
          walkContent(response['content']);
        }
      }

      const response = part['response'];
      if (isRecord(response)) {
        walkContent(response['content']);
      }
    }
  };

  for (const item of input) {
    if (!isRecord(item)) {
      continue;
    }
    walkContent(item['content']);
  }

  if (replaced === 0) {
    throw new Error('未找到 openai-responses 图片节点用于注入损坏数据');
  }

  return JSON.stringify(root);
}

afterEach(() => {
  while (cleanups.length > 0) {
    const cleanup = cleanups.pop();
    if (cleanup !== undefined) {
      cleanup();
    }
  }
});

describe('proxy integration E2E', () => {
  test('Scenario 1: OpenAI Chat Completions 图像转换 + Content-Length 校验', async () => {
    const runtime = setupE2E(true);
    cleanups.push(runtime.cleanup);

    runtime.mockTarget.setResponder(() => createJsonResponse({ scenario: 1, ok: true }));

    const fixture = await loadFixtureJson('openai-chat.json');
    const requestBody = JSON.stringify(fixture);
    const originalSnapshot = collectOpenAIChatSnapshot(fixture);

    const response = await fetch(buildProxyUrl(runtime.proxy.port, 'api.openai.com', '/v1/chat/completions'), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': String(byteLength(requestBody)),
      },
      body: requestBody,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ scenario: 1, ok: true });

    const captured = getLastRequest(runtime.mockTarget.requests);
    expect(captured.path).toBe('/v1/chat/completions');
    expect(captured.method).toBe('POST');
    expect(captured.headers.get('content-length')).toBe(String(byteLength(captured.rawBody)));

    const forwardedSnapshot = collectOpenAIChatSnapshot(parseJson(captured.rawBody, 'forwarded openai-chat'));
    expect(forwardedSnapshot.textBlocks).toEqual(originalSnapshot.textBlocks);
    expect(forwardedSnapshot.imageUrls.length).toBe(originalSnapshot.imageUrls.length);
    expect(forwardedSnapshot.imageUrls.length).toBeGreaterThan(0);
    for (const imageUrl of forwardedSnapshot.imageUrls) {
      assertDataUriWebP(imageUrl);
    }
  });

  test('Scenario 2: Anthropic Messages 图像转换并保持文本内容', async () => {
    const runtime = setupE2E(true);
    cleanups.push(runtime.cleanup);

    runtime.mockTarget.setResponder(() => createJsonResponse({ scenario: 2, ok: true }));

    const fixture = await loadFixtureJson('anthropic-messages.json');
    const requestBody = JSON.stringify(fixture);
    const originalSequence = collectAnthropicSequence(fixture);

    const response = await fetch(buildProxyUrl(runtime.proxy.port, 'api.anthropic.com', '/v1/messages'), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': String(byteLength(requestBody)),
      },
      body: requestBody,
    });

    expect(response.status).toBe(200);

    const captured = getLastRequest(runtime.mockTarget.requests);
    expect(captured.path).toBe('/v1/messages');

    const forwardedSequence = collectAnthropicSequence(parseJson(captured.rawBody, 'forwarded anthropic'));
    const originalTexts = originalSequence.filter(isTextEntry).map((entry) => entry.text);
    const forwardedTexts = forwardedSequence.filter(isTextEntry).map((entry) => entry.text);
    const originalImageCount = originalSequence.filter(isImageEntry).length;
    const forwardedImages = forwardedSequence.filter(isImageEntry);

    expect(forwardedTexts).toEqual(originalTexts);
    expect(forwardedImages.length).toBe(originalImageCount);
    expect(forwardedImages.length).toBeGreaterThan(0);
    for (const image of forwardedImages) {
      expect(image.mediaType).toBe('image/webp');
      assertRawBase64WebP(image.data);
    }
  });

  test('Scenario 3: Gemini GenerateContent inlineData 转为 WebP', async () => {
    const runtime = setupE2E(true);
    cleanups.push(runtime.cleanup);

    runtime.mockTarget.setResponder(() => createJsonResponse({ scenario: 3, ok: true }));

    const fixture = await loadFixtureJson('gemini-generate.json');
    const requestBody = JSON.stringify(fixture);
    const originalInlineData = collectGeminiInlineData(fixture);

    const response = await fetch(
      buildProxyUrl(
        runtime.proxy.port,
        'generativelanguage.googleapis.com',
        '/v1beta/models/gemini-pro:generateContent',
      ),
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': String(byteLength(requestBody)),
        },
        body: requestBody,
      },
    );

    expect(response.status).toBe(200);

    const captured = getLastRequest(runtime.mockTarget.requests);
    expect(captured.path).toBe('/v1beta/models/gemini-pro:generateContent');

    const forwardedInlineData = collectGeminiInlineData(parseJson(captured.rawBody, 'forwarded gemini'));
    expect(forwardedInlineData.length).toBe(originalInlineData.length);
    expect(forwardedInlineData.length).toBeGreaterThan(0);
    for (const image of forwardedInlineData) {
      expect(image.mimeType).toBe('image/webp');
      assertRawBase64WebP(image.data);
    }
  });

  test('Scenario 4: 纯文本请求字节级透传', async () => {
    const runtime = setupE2E(true);
    cleanups.push(runtime.cleanup);

    runtime.mockTarget.setResponder(() => createJsonResponse({ scenario: 4, ok: true }, 201));

    const fixture = await loadFixtureJson('no-images.json');
    const requestBody = JSON.stringify(fixture);

    const response = await fetch(buildProxyUrl(runtime.proxy.port, 'api.openai.com', '/v1/chat/completions'), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': String(byteLength(requestBody)),
      },
      body: requestBody,
    });

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ scenario: 4, ok: true });

    const captured = getLastRequest(runtime.mockTarget.requests);
    expect(captured.rawBody).toBe(requestBody);
    expect(captured.headers.get('content-length')).toBe(String(byteLength(requestBody)));
  });

  test('Scenario 5: Anthropic 混合内容保持顺序，文本不变且图片转换', async () => {
    const runtime = setupE2E(true);
    cleanups.push(runtime.cleanup);

    runtime.mockTarget.setResponder(() => createJsonResponse({ scenario: 5, ok: true }));

    const fixture = await loadFixtureJson('mixed-content.json');
    const requestBody = JSON.stringify(fixture);
    const originalSequence = collectAnthropicSequence(fixture);

    const response = await fetch(buildProxyUrl(runtime.proxy.port, 'api.anthropic.com', '/v1/messages'), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': String(byteLength(requestBody)),
      },
      body: requestBody,
    });

    expect(response.status).toBe(200);

    const captured = getLastRequest(runtime.mockTarget.requests);
    const forwardedSequence = collectAnthropicSequence(parseJson(captured.rawBody, 'forwarded mixed-content'));

    expect(forwardedSequence.length).toBe(originalSequence.length);

    for (let index = 0; index < originalSequence.length; index += 1) {
      const originalEntry = expectIndex(originalSequence, index, 'originalSequence');
      const forwardedEntry = expectIndex(forwardedSequence, index, 'forwardedSequence');

      expect(forwardedEntry.kind).toBe(originalEntry.kind);

      if (originalEntry.kind === 'text') {
        if (forwardedEntry.kind !== 'text') {
          throw new Error('文本顺序被破坏');
        }
        expect(forwardedEntry.text).toBe(originalEntry.text);
        continue;
      }

      if (forwardedEntry.kind !== 'image') {
        throw new Error('图片顺序被破坏');
      }
      expect(forwardedEntry.mediaType).toBe('image/webp');
      assertRawBase64WebP(forwardedEntry.data);
    }
  });

  test('Scenario 6: SSE 流式响应完整透传', async () => {
    const runtime = setupE2E(true);
    cleanups.push(runtime.cleanup);

    const sseChunks = ['event: message\ndata: one\n\n', 'event: message\ndata: two\n\n'];
    runtime.mockTarget.setResponder(() => createSseResponse(sseChunks));

    const response = await fetch(
      buildProxyUrl(runtime.proxy.port, 'api.openai.com', '/v1/chat/completions?stream=true'),
      {
        method: 'GET',
      },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(await response.text()).toBe(sseChunks.join(''));

    const captured = getLastRequest(runtime.mockTarget.requests);
    expect(captured.path).toBe('/v1/chat/completions');
    expect(captured.search).toBe('?stream=true');
  });

  test('Scenario 7: 关闭图片处理器时请求体不应被修改', async () => {
    const runtime = setupE2E(false);
    cleanups.push(runtime.cleanup);

    runtime.mockTarget.setResponder(() => createJsonResponse({ scenario: 7, ok: true }));

    const fixture = await loadFixtureJson('openai-chat.json');
    const requestBody = JSON.stringify(fixture);
    const originalSnapshot = collectOpenAIChatSnapshot(fixture);

    const response = await fetch(buildProxyUrl(runtime.proxy.port, 'api.openai.com', '/v1/chat/completions'), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': String(byteLength(requestBody)),
      },
      body: requestBody,
    });

    expect(response.status).toBe(200);

    const captured = getLastRequest(runtime.mockTarget.requests);
    expect(captured.rawBody).toBe(requestBody);

    const forwardedSnapshot = collectOpenAIChatSnapshot(parseJson(captured.rawBody, 'forwarded disabled-image'));
    expect(forwardedSnapshot.imageUrls).toEqual(originalSnapshot.imageUrls);
    expect(forwardedSnapshot.textBlocks).toEqual(originalSnapshot.textBlocks);
  });

  test('Scenario 8: 损坏 base64 时优雅降级并保持原始数据', async () => {
    const runtime = setupE2E(true);
    cleanups.push(runtime.cleanup);

    runtime.mockTarget.setResponder(() => createJsonResponse({ scenario: 8, ok: true }));

    const fixture = await loadFixtureJson('openai-responses.json');
    const corruptedDataUri = 'data:image/png;base64,iVBORw0KGgo=';
    const requestBody = replaceAllOpenAIResponsesImages(fixture, corruptedDataUri);
    const expectedSnapshot = collectOpenAIResponsesSnapshot(parseJson(requestBody, 'corrupted request body'));

    const response = await fetch(buildProxyUrl(runtime.proxy.port, 'api.openai.com', '/v1/responses'), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': String(byteLength(requestBody)),
      },
      body: requestBody,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ scenario: 8, ok: true });

    const captured = getLastRequest(runtime.mockTarget.requests);
    const forwardedSnapshot = collectOpenAIResponsesSnapshot(
      parseJson(captured.rawBody, 'forwarded corrupted openai-responses'),
    );

    expect(forwardedSnapshot.textBlocks).toEqual(expectedSnapshot.textBlocks);
    expect(forwardedSnapshot.imageUrls).toEqual(expectedSnapshot.imageUrls);
    expect(forwardedSnapshot.imageUrls.length).toBeGreaterThan(0);
    for (const imageUrl of forwardedSnapshot.imageUrls) {
      expect(imageUrl).toBe(corruptedDataUri);
    }
  });
});
