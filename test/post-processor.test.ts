import { describe, expect, test } from 'bun:test';
import type { AppConfig, PostProcessor, PostProcessorContext } from '../src/types/index.js';
import { PostProcessorManager } from '../src/processors/post-processor.js';

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

function createContext(responseBody: unknown = { ok: true }): PostProcessorContext {
  return {
    responseBody,
    apiFormat: 'openai-responses',
    targetUrl: 'https://api.openai.com/v1/responses',
    headers: { 'content-type': 'application/json' },
    config: TEST_CONFIG,
  };
}

function registerProcessor(manager: PostProcessorManager, processor: PostProcessor): void {
  const maybeRegister = manager as unknown as { register?: (processor: PostProcessor) => void };
  if (typeof maybeRegister.register === 'function') {
    maybeRegister.register(processor);
    return;
  }

  const withInternal = manager as unknown as { processors?: PostProcessor[] };
  if (Array.isArray(withInternal.processors)) {
    withInternal.processors.push(processor);
    return;
  }

  throw new Error('PostProcessorManager has no registration entrypoint');
}

describe('PostProcessorManager', () => {
  test('supports processor registration for later retrieval', () => {
    const manager = new PostProcessorManager();

    registerProcessor(manager, {
      name: 'pass-through',
      async process(context: PostProcessorContext): Promise<PostProcessorContext> {
        return context;
      },
    });

    const processors = manager.getProcessors();
    expect(processors).toHaveLength(1);
    expect(processors[0]?.name).toBe('pass-through');
  });

  test('getProcessors() returns a defensive copy', () => {
    const manager = new PostProcessorManager();

    registerProcessor(manager, {
      name: 'single',
      async process(context: PostProcessorContext): Promise<PostProcessorContext> {
        return context;
      },
    });

    const snapshot = manager.getProcessors();
    snapshot.pop();

    expect(manager.getProcessors()).toHaveLength(1);
  });

  test('process() keeps context unchanged when no processor is registered', async () => {
    const manager = new PostProcessorManager();
    const context = createContext({ id: 'response_1' });

    const result = await manager.process(context);

    expect(result).toBe(context);
    expect(result.responseBody).toEqual({ id: 'response_1' });
  });

  test('process() runs registered processors sequentially', async () => {
    const manager = new PostProcessorManager();
    const order: string[] = [];

    registerProcessor(manager, {
      name: 'first',
      async process(context: PostProcessorContext): Promise<PostProcessorContext> {
        order.push('first');
        return {
          ...context,
          responseBody: {
            ...(context.responseBody as Record<string, unknown>),
            first: true,
          },
        };
      },
    });

    registerProcessor(manager, {
      name: 'second',
      async process(context: PostProcessorContext): Promise<PostProcessorContext> {
        order.push('second');
        return {
          ...context,
          responseBody: {
            ...(context.responseBody as Record<string, unknown>),
            second: true,
          },
        };
      },
    });

    const result = await manager.process(createContext({ seed: 1 }));

    expect(order).toEqual(['first', 'second']);
    expect(result.responseBody).toEqual({ seed: 1, first: true, second: true });
  });
});
