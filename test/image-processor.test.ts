import { describe, expect, test } from 'bun:test';
import { ImageProcessor } from '../src/processors/image/index.js';
import { findImageNodes } from '../src/processors/image/traversal.js';
import type {
  AnthropicMessagesRequest,
  GeminiGenerateRequest,
  OpenAIChatRequest,
  OpenAIResponsesRequest,
} from '../src/types/api-formats.js';
import type {
  ApiFormat,
  AppConfig,
  ImageProcessorConfig,
  ProcessorContext,
} from '../src/types/index.js';

const IMAGE_CONFIG: ImageProcessorConfig = {
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
};

const APP_CONFIG: AppConfig = {
  server: {
    port: 3000,
    host: '0.0.0.0',
    maxPayloadSize: '50mb',
  },
  processors: {
    image: IMAGE_CONFIG,
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

async function loadFixture<T>(fileName: string): Promise<T> {
  const fixtureUrl = new URL(`./fixtures/${fileName}`, import.meta.url);
  return (await Bun.file(fixtureUrl).json()) as T;
}

function createContext(body: unknown, apiFormat: ApiFormat): ProcessorContext {
  return {
    requestBody: body,
    apiFormat,
    targetUrl: 'https://api.openai.com/v1/chat/completions',
    headers: {
      'content-type': 'application/json',
    },
    config: APP_CONFIG,
  };
}

function getOpenAIChatImageUrl(body: OpenAIChatRequest, messageIndex: number): string {
  const message = body.messages[messageIndex];
  if (!message || !Array.isArray(message.content)) {
    throw new Error(`missing content array at messages[${messageIndex}]`);
  }

  const imagePart = message.content[1];
  if (!imagePart || imagePart.type !== 'image_url') {
    throw new Error(`missing image_url part at messages[${messageIndex}].content[1]`);
  }

  return imagePart.image_url.url;
}

describe('ImageProcessor', () => {
  test('converts OpenAI Chat image nodes to WebP', async () => {
    const body = await loadFixture<OpenAIChatRequest>('openai-chat.json');
    const processor = new ImageProcessor(IMAGE_CONFIG);

    const beforeNodes = findImageNodes(body, 'openai-chat');
    expect(beforeNodes.length).toBe(2);
    expect(beforeNodes.every((node) => node.mimeType === 'image/png')).toBe(true);

    await processor.process(createContext(body, 'openai-chat'));

    const afterNodes = findImageNodes(body, 'openai-chat');
    expect(afterNodes.length).toBe(2);
    expect(afterNodes.every((node) => node.mimeType === 'image/webp')).toBe(true);
  });

  test('converts OpenAI Responses image nodes to WebP', async () => {
    const body = await loadFixture<OpenAIResponsesRequest>('openai-responses.json');
    const processor = new ImageProcessor(IMAGE_CONFIG);

    const beforeNodes = findImageNodes(body, 'openai-responses');
    expect(beforeNodes.length).toBe(2);
    expect(beforeNodes.every((node) => node.mimeType === 'image/png')).toBe(true);

    await processor.process(createContext(body, 'openai-responses'));

    const afterNodes = findImageNodes(body, 'openai-responses');
    expect(afterNodes.length).toBe(2);
    expect(afterNodes.every((node) => node.mimeType === 'image/webp')).toBe(true);
  });

  test('converts Anthropic image nodes to WebP', async () => {
    const body = await loadFixture<AnthropicMessagesRequest>('anthropic-messages.json');
    const processor = new ImageProcessor(IMAGE_CONFIG);

    const beforeNodes = findImageNodes(body, 'anthropic');
    expect(beforeNodes.length).toBe(2);
    expect(beforeNodes.every((node) => node.mimeType === 'image/png')).toBe(true);

    await processor.process(createContext(body, 'anthropic'));

    const afterNodes = findImageNodes(body, 'anthropic');
    expect(afterNodes.length).toBe(2);
    expect(afterNodes.every((node) => node.mimeType === 'image/webp')).toBe(true);
  });

  test('converts Gemini image nodes to WebP', async () => {
    const body = await loadFixture<GeminiGenerateRequest>('gemini-generate.json');
    const processor = new ImageProcessor(IMAGE_CONFIG);

    const beforeNodes = findImageNodes(body, 'gemini');
    expect(beforeNodes.length).toBe(2);
    expect(beforeNodes.every((node) => node.mimeType === 'image/png')).toBe(true);

    await processor.process(createContext(body, 'gemini'));

    const afterNodes = findImageNodes(body, 'gemini');
    expect(afterNodes.length).toBe(2);
    expect(afterNodes.every((node) => node.mimeType === 'image/webp')).toBe(true);
  });

  test('gracefully degrades when one image is corrupted', async () => {
    const body = await loadFixture<OpenAIChatRequest>('openai-chat.json');
    const processor = new ImageProcessor(IMAGE_CONFIG);
    const corrupted = 'data:image/png;base64,iVBORw0KGgo=';

    const firstMessage = body.messages[0];
    if (!firstMessage || !Array.isArray(firstMessage.content)) {
      throw new Error('missing first openai-chat message content');
    }
    const firstImagePart = firstMessage.content[1];
    if (!firstImagePart || firstImagePart.type !== 'image_url') {
      throw new Error('missing first openai-chat image part');
    }
    firstImagePart.image_url.url = corrupted;

    const captured: string[] = [];
    const originalWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = (chunk: string | Uint8Array): boolean => {
      captured.push(typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk));
      return true;
    };

    try {
      await processor.process(createContext(body, 'openai-chat'));
    } finally {
      process.stderr.write = originalWrite;
    }

    expect(getOpenAIChatImageUrl(body, 0)).toBe(corrupted);
    expect(getOpenAIChatImageUrl(body, 2).startsWith('data:image/webp;base64,')).toBe(true);

    const warnLog = captured
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .find(
        (entry) =>
          entry['component'] === 'imageProcessor' &&
          entry['level'] === 'warn' &&
          entry['message'] === 'Failed to convert image, keeping original',
      );

    expect(warnLog).toBeDefined();
  });

  test('returns passthrough context when request has no images', async () => {
    const body = await loadFixture<OpenAIChatRequest>('no-images.json');
    const processor = new ImageProcessor(IMAGE_CONFIG);
    const context = createContext(body, 'openai-chat');
    const before = JSON.stringify(body);

    const result = await processor.process(context);

    expect(result).toBe(context);
    expect(JSON.stringify(body)).toBe(before);
  });

  test('enabled() reflects config.enabled', () => {
    const processor = new ImageProcessor({
      ...IMAGE_CONFIG,
      enabled: false,
    });

    expect(processor.enabled()).toBe(false);
  });

  test('skips processing when api format is unknown', async () => {
    const body = await loadFixture<OpenAIChatRequest>('openai-chat.json');
    const processor = new ImageProcessor(IMAGE_CONFIG);
    const context = createContext(body, 'unknown');
    const before = getOpenAIChatImageUrl(body, 0);

    const result = await processor.process(context);

    expect(result).toBe(context);
    expect(getOpenAIChatImageUrl(body, 0)).toBe(before);
  });
});
