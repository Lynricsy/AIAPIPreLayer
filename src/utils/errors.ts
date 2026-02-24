/**
 * Error thrown when a processor fails during request transformation.
 * Includes processor name and original error for debugging.
 */
export class ProcessorError extends Error {
  constructor(
    public readonly processorName: string,
    public readonly originalError: Error,
    public readonly context?: Record<string, unknown>
  ) {
    super(`Processor "${processorName}" failed: ${originalError.message}`);
    this.name = 'ProcessorError';
  }
}

/**
 * Error thrown when request payload exceeds configured maximum.
 */
export class PayloadTooLargeError extends Error {
  constructor(
    public readonly actualSize: number,
    public readonly maxSize: number
  ) {
    super(`Payload size ${actualSize} bytes exceeds maximum ${maxSize} bytes`);
    this.name = 'PayloadTooLargeError';
  }
}

/**
 * Error thrown when configuration validation fails.
 */
export class ConfigValidationError extends Error {
  constructor(
    public readonly field: string,
    public readonly value: unknown,
    public readonly constraint: string
  ) {
    super(`Invalid config: "${field}" value ${JSON.stringify(value)} ${constraint}`);
    this.name = 'ConfigValidationError';
  }
}

/**
 * Error thrown when URL routing/target extraction fails.
 */
export class RoutingError extends Error {
  constructor(
    public readonly requestPath: string,
    reason: string
  ) {
    super(`Routing error for "${requestPath}": ${reason}`);
    this.name = 'RoutingError';
  }
}
