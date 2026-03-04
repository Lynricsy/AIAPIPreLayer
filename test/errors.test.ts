import { test, expect, describe } from 'bun:test';
import { PassThrough } from 'stream';
import {
  ProcessorError,
  PayloadTooLargeError,
  ConfigValidationError,
  RoutingError,
} from '../src/utils/errors';
import { createLogger, _setRootLoggerForTest } from '../src/utils/logger';

describe('ProcessorError', () => {
  test('has correct name, message, processorName, and originalError', () => {
    const original = new Error('timeout');
    const err = new ProcessorError('imageResizer', original, { width: 100 });

    expect(err.name).toBe('ProcessorError');
    expect(err.message).toBe('Processor "imageResizer" failed: timeout');
    expect(err.processorName).toBe('imageResizer');
    expect(err.originalError).toBe(original);
    expect(err.context).toEqual({ width: 100 });
    expect(err).toBeInstanceOf(Error);
  });
});

describe('PayloadTooLargeError', () => {
  test('has correct name, message, actualSize, and maxSize', () => {
    const err = new PayloadTooLargeError(2048, 1024);

    expect(err.name).toBe('PayloadTooLargeError');
    expect(err.message).toBe('Payload size 2048 bytes exceeds maximum 1024 bytes');
    expect(err.actualSize).toBe(2048);
    expect(err.maxSize).toBe(1024);
    expect(err).toBeInstanceOf(Error);
  });
});

describe('ConfigValidationError', () => {
  test('has correct name, message, field, value, and constraint', () => {
    const err = new ConfigValidationError('maxRetries', -1, 'must be >= 0');

    expect(err.name).toBe('ConfigValidationError');
    expect(err.message).toBe('Invalid config: "maxRetries" value -1 must be >= 0');
    expect(err.field).toBe('maxRetries');
    expect(err.value).toBe(-1);
    expect(err.constraint).toBe('must be >= 0');
    expect(err).toBeInstanceOf(Error);
  });
});

describe('RoutingError', () => {
  test('has correct name, message, and requestPath', () => {
    const err = new RoutingError('/api/unknown', 'no matching route');

    expect(err.name).toBe('RoutingError');
    expect(err.message).toBe('Routing error for "/api/unknown": no matching route');
    expect(err.requestPath).toBe('/api/unknown');
    expect(err).toBeInstanceOf(Error);
  });
});

describe('All errors are instanceof Error', () => {
  test('all custom errors extend Error', () => {
    expect(new ProcessorError('p', new Error('x'))).toBeInstanceOf(Error);
    expect(new PayloadTooLargeError(1, 2)).toBeInstanceOf(Error);
    expect(new ConfigValidationError('f', 'v', 'c')).toBeInstanceOf(Error);
    expect(new RoutingError('/path', 'reason')).toBeInstanceOf(Error);
  });
});

describe('createLogger', () => {
  function createCaptureStream() {
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

  function flush(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 50));
  }

  test('info level logger suppresses debug messages', async () => {
    const { stream, lines } = createCaptureStream();
    _setRootLoggerForTest('debug', stream);
    const logger = createLogger('test-component', 'info');

    logger.debug('this should be suppressed');
    logger.info('this should appear');
    await flush();

    const entries = lines();
    expect(entries).toHaveLength(1);
    expect(entries[0]!['level']).toBe(30);
    expect(entries[0]!['msg']).toBe('this should appear');
    expect(entries[0]!['component']).toBe('test-component');
  });

  test('error messages always shown regardless of level', async () => {
    const { stream, lines } = createCaptureStream();
    _setRootLoggerForTest('debug', stream);
    const logger = createLogger('test-component', 'warn');

    logger.debug('suppressed');
    logger.info('suppressed');
    logger.warn('warn shown');
    logger.error('error shown');
    await flush();

    const entries = lines();
    expect(entries).toHaveLength(2);
    expect(entries[0]!['level']).toBe(40);
    expect(entries[1]!['level']).toBe(50);
  });

  test('logger includes metadata when provided', async () => {
    const { stream, lines } = createCaptureStream();
    _setRootLoggerForTest('debug', stream);
    const logger = createLogger('meta-test');

    logger.info('with meta', { requestId: '123', status: 200 });
    await flush();

    const entries = lines();
    expect(entries).toHaveLength(1);
    expect(entries[0]!['requestId']).toBe('123');
    expect(entries[0]!['status']).toBe(200);
  });
});
