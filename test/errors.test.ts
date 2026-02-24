import { test, expect, describe } from 'bun:test';
import {
  ProcessorError,
  PayloadTooLargeError,
  ConfigValidationError,
  RoutingError,
} from '../src/utils/errors';
import { createLogger } from '../src/utils/logger';

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
  test('info level logger suppresses debug messages', () => {
    const captured: string[] = [];
    const originalWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = (chunk: string | Uint8Array) => {
      captured.push(typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk));
      return true;
    };

    try {
      const logger = createLogger('test-component', 'info');
      logger.debug('this should be suppressed');
      logger.info('this should appear');
    } finally {
      process.stderr.write = originalWrite;
    }

    expect(captured).toHaveLength(1);
    const parsed = JSON.parse(captured[0]!) as Record<string, unknown>;
    expect(parsed['level']).toBe('info');
    expect(parsed['message']).toBe('this should appear');
    expect(parsed['component']).toBe('test-component');
  });

  test('error messages always shown regardless of level', () => {
    const captured: string[] = [];
    const originalWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = (chunk: string | Uint8Array) => {
      captured.push(typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk));
      return true;
    };

    try {
      const logger = createLogger('test-component', 'warn');
      logger.debug('suppressed');
      logger.info('suppressed');
      logger.warn('warn shown');
      logger.error('error shown');
    } finally {
      process.stderr.write = originalWrite;
    }

    expect(captured).toHaveLength(2);
    const warn = JSON.parse(captured[0]!) as Record<string, unknown>;
    const error = JSON.parse(captured[1]!) as Record<string, unknown>;
    expect(warn['level']).toBe('warn');
    expect(error['level']).toBe('error');
  });

  test('logger includes metadata when provided', () => {
    const captured: string[] = [];
    const originalWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = (chunk: string | Uint8Array) => {
      captured.push(typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk));
      return true;
    };

    try {
      const logger = createLogger('meta-test');
      logger.info('with meta', { requestId: '123', status: 200 });
    } finally {
      process.stderr.write = originalWrite;
    }

    expect(captured).toHaveLength(1);
    const parsed = JSON.parse(captured[0]!) as Record<string, unknown>;
    expect(parsed['metadata']).toEqual({ requestId: '123', status: 200 });
  });
});
