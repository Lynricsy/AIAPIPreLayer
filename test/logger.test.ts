import { describe, expect, test } from 'bun:test';
import { createLogger } from '../src/utils/logger.js';

function captureStderr(run: () => void): string[] {
  const captured: string[] = [];
  const originalWrite = process.stderr.write.bind(process.stderr);

  process.stderr.write = (chunk: string | Uint8Array): boolean => {
    captured.push(typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk));
    return true;
  };

  try {
    run();
  } finally {
    process.stderr.write = originalWrite;
  }

  return captured;
}

function parseEntry(line: string): Record<string, unknown> {
  return JSON.parse(line.trim()) as Record<string, unknown>;
}

describe('createLogger', () => {
  test('returns logger object with debug/info/warn/error methods', () => {
    const logger = createLogger('logger-shape');

    expect(typeof logger.debug).toBe('function');
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.warn).toBe('function');
    expect(typeof logger.error).toBe('function');
  });

  test('filters debug logs when level is info', () => {
    const output = captureStderr(() => {
      const logger = createLogger('level-filter-info', 'info');
      logger.debug('hidden');
      logger.info('visible');
    });

    expect(output).toHaveLength(1);
    expect(parseEntry(output[0] ?? '')['level']).toBe('info');
  });

  test('filters info logs when level is warn', () => {
    const output = captureStderr(() => {
      const logger = createLogger('level-filter-warn', 'warn');
      logger.info('hidden');
      logger.warn('visible-warn');
      logger.error('visible-error');
    });

    expect(output).toHaveLength(2);
    const levels = output.map((line) => parseEntry(line)['level']);
    expect(levels).toEqual(['warn', 'error']);
  });

  test('emits all levels when logger level is debug', () => {
    const output = captureStderr(() => {
      const logger = createLogger('level-debug', 'debug');
      logger.debug('d');
      logger.info('i');
      logger.warn('w');
      logger.error('e');
    });

    expect(output).toHaveLength(4);
    const levels = output.map((line) => parseEntry(line)['level']);
    expect(levels).toEqual(['debug', 'info', 'warn', 'error']);
  });

  test('writes newline-delimited JSON entries with core fields', () => {
    const output = captureStderr(() => {
      const logger = createLogger('json-shape', 'debug');
      logger.info('hello world');
    });

    expect(output).toHaveLength(1);
    expect(output[0]?.endsWith('\n')).toBe(true);

    const entry = parseEntry(output[0] ?? '');
    expect(entry['level']).toBe('info');
    expect(entry['component']).toBe('json-shape');
    expect(entry['message']).toBe('hello world');
    const timestamp = entry['timestamp'];
    expect(typeof timestamp).toBe('string');
    expect(Number.isNaN(Date.parse(String(timestamp)))).toBe(false);
  });

  test('omits metadata field when metadata is not provided', () => {
    const output = captureStderr(() => {
      const logger = createLogger('metadata-optional');
      logger.info('without metadata');
    });

    const entry = parseEntry(output[0] ?? '');
    expect('metadata' in entry).toBe(false);
  });

  test('includes metadata field when metadata is provided', () => {
    const output = captureStderr(() => {
      const logger = createLogger('metadata-present', 'debug');
      logger.error('with metadata', { requestId: 'req-1', retry: 2 });
    });

    const entry = parseEntry(output[0] ?? '');
    expect(entry['metadata']).toEqual({ requestId: 'req-1', retry: 2 });
  });
});
