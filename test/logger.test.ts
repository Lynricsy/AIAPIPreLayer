import { describe, expect, test, beforeEach } from 'bun:test';
import { PassThrough } from 'stream';
import { createLogger, initLogger, _setRootLoggerForTest } from '../src/utils/logger.js';
import type { LogLevel } from '../src/utils/logger.js';

function createCaptureStream(): { stream: PassThrough; lines: () => Record<string, unknown>[] } {
  const stream = new PassThrough();
  const chunks: string[] = [];
  stream.on('data', (chunk: Buffer) => chunks.push(chunk.toString()));

  return {
    stream,
    lines: () =>
      chunks
        .join('')
        .split('\n')
        .filter((l) => l.trim().length > 0)
        .map((l) => JSON.parse(l) as Record<string, unknown>),
  };
}

function setupTest(level: LogLevel = 'debug') {
  const { stream, lines } = createCaptureStream();
  _setRootLoggerForTest(level, stream);
  return { lines, stream };
}

function flush(stream: PassThrough): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 50));
}

describe('createLogger', () => {
  test('returns logger object with debug/info/warn/error methods', () => {
    const logger = createLogger('logger-shape');

    expect(typeof logger.debug).toBe('function');
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.warn).toBe('function');
    expect(typeof logger.error).toBe('function');
  });

  test('filters debug logs when level is info', async () => {
    const { lines, stream } = setupTest('debug');
    const logger = createLogger('level-filter-info', 'info');

    logger.debug('hidden');
    logger.info('visible');
    await flush(stream);

    const entries = lines();
    expect(entries).toHaveLength(1);
    expect(entries[0]!['level']).toBe(30);
    expect(entries[0]!['msg']).toBe('visible');
  });

  test('filters info logs when level is warn', async () => {
    const { lines, stream } = setupTest('debug');
    const logger = createLogger('level-filter-warn', 'warn');

    logger.info('hidden');
    logger.warn('visible-warn');
    logger.error('visible-error');
    await flush(stream);

    const entries = lines();
    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e['level'])).toEqual([40, 50]);
  });

  test('emits all levels when logger level is debug', async () => {
    const { lines, stream } = setupTest('debug');
    const logger = createLogger('level-debug', 'debug');

    logger.debug('d');
    logger.info('i');
    logger.warn('w');
    logger.error('e');
    await flush(stream);

    const entries = lines();
    expect(entries).toHaveLength(4);
    expect(entries.map((e) => e['level'])).toEqual([20, 30, 40, 50]);
  });

  test('writes newline-delimited JSON with pino core fields', async () => {
    const { lines, stream } = setupTest('debug');
    const logger = createLogger('json-shape', 'debug');

    logger.info('hello world');
    await flush(stream);

    const entries = lines();
    expect(entries).toHaveLength(1);

    const entry = entries[0]!;
    expect(entry['level']).toBe(30);
    expect(entry['msg']).toBe('hello world');
    expect(entry['component']).toBe('json-shape');
    expect(typeof entry['time']).toBe('number');
    expect(typeof entry['pid']).toBe('number');
    expect(typeof entry['hostname']).toBe('string');
  });

  test('spreads metadata at top level when metadata is provided', async () => {
    const { lines, stream } = setupTest('debug');
    const logger = createLogger('metadata-present', 'debug');

    logger.error('with metadata', { requestId: 'req-1', retry: 2 });
    await flush(stream);

    const entry = lines()[0]!;
    expect(entry['requestId']).toBe('req-1');
    expect(entry['retry']).toBe(2);
    expect(entry['msg']).toBe('with metadata');
    expect('metadata' in entry).toBe(false);
  });

  test('omits extra keys when metadata is not provided', async () => {
    const { lines, stream } = setupTest('debug');
    const logger = createLogger('metadata-optional');

    logger.info('without metadata');
    await flush(stream);

    const entry = lines()[0]!;
    expect(entry['msg']).toBe('without metadata');
    expect('requestId' in entry).toBe(false);
    expect('metadata' in entry).toBe(false);
  });
});

describe('initLogger', () => {
  test('reconfigures root logger for json format', async () => {
    const { lines, stream } = setupTest('info');
    const logger = createLogger('init-test');

    logger.info('after init');
    await flush(stream);

    const entries = lines();
    expect(entries.length).toBeGreaterThanOrEqual(1);
    expect(entries[0]!['component']).toBe('init-test');
  });

  test('text format does not throw', () => {
    expect(() => {
      initLogger({ level: 'info', format: 'text' });
    }).not.toThrow();
  });
});
