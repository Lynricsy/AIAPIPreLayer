import pino from 'pino';
import type { LoggingConfig } from '../types/index.ts';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  debug(message: string, metadata?: Record<string, unknown>): void;
  info(message: string, metadata?: Record<string, unknown>): void;
  warn(message: string, metadata?: Record<string, unknown>): void;
  error(message: string, metadata?: Record<string, unknown>): void;
}

let rootLogger: pino.Logger = pino({ level: 'info' }, pino.destination(2));

export function initLogger(config: LoggingConfig): void {
  if (config.format === 'text') {
    rootLogger = pino(
      { level: config.level },
      pino.transport({
        target: 'pino-pretty',
        options: { destination: 2 },
      }),
    );
  } else {
    rootLogger = pino({ level: config.level }, pino.destination(2));
  }
}

export function createLogger(component: string, level: LogLevel = 'info'): Logger {
  const child = rootLogger.child({ component });
  child.level = level;

  const wrap = (lvl: LogLevel) => {
    return (message: string, metadata?: Record<string, unknown>): void => {
      if (metadata) {
        child[lvl]({ ...metadata }, message);
      } else {
        child[lvl](message);
      }
    };
  };

  return {
    debug: wrap('debug'),
    info: wrap('info'),
    warn: wrap('warn'),
    error: wrap('error'),
  };
}
