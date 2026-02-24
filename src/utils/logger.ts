type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface Logger {
  debug(message: string, metadata?: Record<string, unknown>): void;
  info(message: string, metadata?: Record<string, unknown>): void;
  warn(message: string, metadata?: Record<string, unknown>): void;
  error(message: string, metadata?: Record<string, unknown>): void;
}

const LOG_LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export function createLogger(component: string, level: LogLevel = 'info'): Logger {
  const minLevel = LOG_LEVEL_ORDER[level];

  function log(msgLevel: LogLevel, message: string, metadata?: Record<string, unknown>): void {
    if (LOG_LEVEL_ORDER[msgLevel] < minLevel) return;

    const entry: Record<string, unknown> = {
      level: msgLevel,
      timestamp: new Date().toISOString(),
      component,
      message,
    };

    if (metadata !== undefined) {
      entry['metadata'] = metadata;
    }

    process.stderr.write(JSON.stringify(entry) + '\n');
  }

  return {
    debug: (message, metadata) => log('debug', message, metadata),
    info: (message, metadata) => log('info', message, metadata),
    warn: (message, metadata) => log('warn', message, metadata),
    error: (message, metadata) => log('error', message, metadata),
  };
}
