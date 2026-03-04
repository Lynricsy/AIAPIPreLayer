import { describe, test, expect } from 'bun:test';
import type {
  ApiFormat,
  ProcessorContext,
  PostProcessorContext,
  PreProcessor,
  PostProcessor,
  AppConfig,
  ImageOutputConfig,
  ImageResizeConfig,
  ImageProcessorConfig,
  ServerConfig,
  LoggingConfig,
  ProcessorsConfig,
  RouteTarget,
} from '../src/types/index.js';
import { PostProcessorManager } from '../src/processors/post-processor.js';

const mockConfig: AppConfig = {
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

describe('Types: ApiFormat', () => {
  test('accepts valid format values', () => {
    const formats: ApiFormat[] = [
      'openai-chat',
      'openai-responses',
      'anthropic',
      'gemini',
      'unknown',
    ];
    expect(formats.length).toBe(5);
  });
});

describe('Types: ProcessorContext', () => {
  test('can be instantiated with correct shape', () => {
    const ctx: ProcessorContext = {
      requestBody: { model: 'gpt-4o', messages: [] },
      apiFormat: 'openai-chat',
      targetUrl: 'https://api.openai.com/v1/chat/completions',
      headers: { 'content-type': 'application/json' },
      config: mockConfig,
    };
    expect(ctx.apiFormat).toBe('openai-chat');
    expect(ctx.targetUrl).toBe('https://api.openai.com/v1/chat/completions');
    expect(ctx.headers['content-type']).toBe('application/json');
    expect(ctx.config.server.port).toBe(3000);
  });
});

describe('Types: PostProcessorContext', () => {
  test('can be instantiated with correct shape', () => {
    const ctx: PostProcessorContext = {
      responseBody: { id: 'resp_001', choices: [] },
      apiFormat: 'anthropic',
      targetUrl: 'https://api.anthropic.com/v1/messages',
      headers: { 'content-type': 'application/json' },
      config: mockConfig,
    };
    expect(ctx.apiFormat).toBe('anthropic');
    expect(ctx.responseBody).toBeDefined();
  });
});

describe('Types: AppConfig structure', () => {
  test('server config has correct shape', () => {
    const server: ServerConfig = mockConfig.server;
    expect(server.port).toBe(3000);
    expect(server.host).toBe('0.0.0.0');
    expect(server.maxPayloadSize).toBe('50mb');
  });

  test('logging config has correct shape', () => {
    const logging: LoggingConfig = mockConfig.logging;
    expect(logging.level).toBe('info');
    expect(logging.format).toBe('json');
  });

  test('processors config has correct shape', () => {
    const processors: ProcessorsConfig = mockConfig.processors;
    const image: ImageProcessorConfig = processors.image;
    const output: ImageOutputConfig = image.output;
    const resize: ImageResizeConfig = image.resize;
    expect(image.enabled).toBe(true);
    expect(output.format).toBe('webp');
    expect(output.quality).toBe(80);
    expect(resize.maxWidth).toBe(2048);
  });
});

describe('Types: RouteTarget', () => {
  test('can be instantiated with correct shape', () => {
    const route: RouteTarget = {
      targetUrl: 'https://api.openai.com/v1/chat/completions',
      protocol: 'https:',
      host: 'api.openai.com',
      path: '/v1/chat/completions',
    };
    expect(route.protocol).toBe('https:');
    expect(route.host).toBe('api.openai.com');
  });
});

describe('PostProcessorManager', () => {
  test('getProcessors() returns empty array initially', () => {
    const manager = new PostProcessorManager();
    const processors: PostProcessor[] = manager.getProcessors();
    expect(processors).toBeArray();
    expect(processors.length).toBe(0);
  });

  test('getProcessors() returns a copy (not the internal array)', () => {
    const manager = new PostProcessorManager();
    const a = manager.getProcessors();
    const b = manager.getProcessors();
    expect(a).not.toBe(b);
  });

  test('process() passes through context when no processors registered', async () => {
    const manager = new PostProcessorManager();
    const ctx: PostProcessorContext = {
      responseBody: { result: 'ok' },
      apiFormat: 'gemini',
      targetUrl: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent',
      headers: {},
      config: mockConfig,
    };
    const result = await manager.process(ctx);
    expect(result).toBe(ctx);
    expect(result.apiFormat).toBe('gemini');
    expect(result.responseBody).toEqual({ result: 'ok' });
  });

  test('process() runs all registered processors in order', async () => {
    const manager = new PostProcessorManager();

    const callOrder: string[] = [];

    const p1: PostProcessor = {
      name: 'processor-1',
      async process(context: PostProcessorContext): Promise<PostProcessorContext> {
        callOrder.push('p1');
        return { ...context, responseBody: { ...((context.responseBody as Record<string, unknown>)), step: 1 } };
      },
    };

    const p2: PostProcessor = {
      name: 'processor-2',
      async process(context: PostProcessorContext): Promise<PostProcessorContext> {
        callOrder.push('p2');
        return { ...context, responseBody: { ...((context.responseBody as Record<string, unknown>)), step: 2 } };
      },
    };

    const internalProcessors = (manager as unknown as { processors: PostProcessor[] }).processors;
    internalProcessors.push(p1, p2);

    const ctx: PostProcessorContext = {
      responseBody: {},
      apiFormat: 'openai-responses',
      targetUrl: 'https://api.openai.com/v1/responses',
      headers: {},
      config: mockConfig,
    };

    const result = await manager.process(ctx);
    expect(callOrder).toEqual(['p1', 'p2']);
    expect((result.responseBody as Record<string, unknown>)['step']).toBe(2);
  });
});

describe('Types: PreProcessor interface', () => {
  test('can implement PreProcessor interface', async () => {
    const processor: PreProcessor = {
      name: 'test-processor',
      async process(context: ProcessorContext): Promise<ProcessorContext> {
        return context;
      },
    };
    expect(processor.name).toBe('test-processor');
    const ctx: ProcessorContext = {
      requestBody: {},
      apiFormat: 'unknown',
      targetUrl: 'https://example.com',
      headers: {},
      config: mockConfig,
    };
    const result = await processor.process(ctx);
    expect(result).toBe(ctx);
  });
});
