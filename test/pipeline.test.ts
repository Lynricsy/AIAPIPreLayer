import { describe, test, expect } from 'bun:test';
import type { AppConfig, PreProcessor, ProcessorContext } from '../src/types/index.js';
import { PreProcessorManager } from '../src/pipeline.js';

type ControlledPreProcessor = PreProcessor & {
  enabled(context: ProcessorContext): boolean;
};

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
  },
  logging: {
    level: 'info',
    format: 'json',
  },
};

function createContext(): ProcessorContext {
  return {
    requestBody: { model: 'gpt-4o' },
    apiFormat: 'openai-chat',
    targetUrl: 'https://api.openai.com/v1/chat/completions',
    headers: { 'content-type': 'application/json' },
    config: mockConfig,
  };
}

describe('PreProcessorManager', () => {
  test('getProcessors() returns a defensive copy', () => {
    const manager = new PreProcessorManager();
    const a = manager.getProcessors();
    const b = manager.getProcessors();

    expect(a).toEqual([]);
    expect(b).toEqual([]);
    expect(a).not.toBe(b);
  });

  test('process() runs a single registered processor', async () => {
    const manager = new PreProcessorManager();

    const processor: PreProcessor = {
      name: 'single-processor',
      async process(context: ProcessorContext): Promise<ProcessorContext> {
        return {
          ...context,
          requestBody: {
            ...(context.requestBody as Record<string, unknown>),
            transformed: true,
          },
        };
      },
    };

    manager.register(processor);

    const result = await manager.process(createContext());
    expect((result.requestBody as Record<string, unknown>)['transformed']).toBe(true);
  });

  test('process() runs multiple processors in registration order', async () => {
    const manager = new PreProcessorManager();
    const callOrder: string[] = [];

    manager.register({
      name: 'processor-1',
      async process(context: ProcessorContext): Promise<ProcessorContext> {
        callOrder.push('p1');
        return {
          ...context,
          requestBody: {
            ...(context.requestBody as Record<string, unknown>),
            step: 1,
          },
        };
      },
    });

    manager.register({
      name: 'processor-2',
      async process(context: ProcessorContext): Promise<ProcessorContext> {
        callOrder.push('p2');
        return {
          ...context,
          requestBody: {
            ...(context.requestBody as Record<string, unknown>),
            step: 2,
          },
        };
      },
    });

    const result = await manager.process(createContext());
    expect(callOrder).toEqual(['p1', 'p2']);
    expect((result.requestBody as Record<string, unknown>)['step']).toBe(2);
  });

  test('process() skips processor when enabled() returns false', async () => {
    const manager = new PreProcessorManager();
    const callOrder: string[] = [];

    const disabledProcessor: ControlledPreProcessor = {
      name: 'disabled-processor',
      enabled(): boolean {
        return false;
      },
      async process(context: ProcessorContext): Promise<ProcessorContext> {
        callOrder.push('disabled');
        return context;
      },
    };

    const activeProcessor: ControlledPreProcessor = {
      name: 'active-processor',
      enabled(): boolean {
        return true;
      },
      async process(context: ProcessorContext): Promise<ProcessorContext> {
        callOrder.push('active');
        return {
          ...context,
          requestBody: {
            ...(context.requestBody as Record<string, unknown>),
            afterEnabledCheck: true,
          },
        };
      },
    };

    manager.register(disabledProcessor);
    manager.register(activeProcessor);

    const result = await manager.process(createContext());

    expect(callOrder).toEqual(['active']);
    expect((result.requestBody as Record<string, unknown>)['afterEnabledCheck']).toBe(true);
  });

  test('process() logs warning and continues when a processor throws', async () => {
    const manager = new PreProcessorManager();

    manager.register({
      name: 'failing-processor',
      async process(): Promise<ProcessorContext> {
        throw new Error('processor failed');
      },
    });

    manager.register({
      name: 'recovery-processor',
      async process(context: ProcessorContext): Promise<ProcessorContext> {
        return {
          ...context,
          headers: {
            ...context.headers,
            'x-recovered': 'true',
          },
        };
      },
    });

    const captured: string[] = [];
    const originalWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = (chunk: string | Uint8Array) => {
      captured.push(typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk));
      return true;
    };

    try {
      const result = await manager.process(createContext());
      expect(result.headers['x-recovered']).toBe('true');
    } finally {
      process.stderr.write = originalWrite;
    }

    expect(captured.length).toBeGreaterThan(0);

    const parsedLogs = captured.map((line) => JSON.parse(line) as Record<string, unknown>);
    const warnLog = parsedLogs.find((entry) => entry['level'] === 'warn');

    expect(warnLog).toBeDefined();
    expect(warnLog?.['component']).toBe('pipeline');
    expect(warnLog?.['message']).toBe('processor failed, continue with next');
  });

  test('process() returns original context when pipeline is empty', async () => {
    const manager = new PreProcessorManager();
    const context = createContext();

    const result = await manager.process(context);

    expect(result).toBe(context);
  });
});
