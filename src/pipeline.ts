import { ProcessorError } from './utils/errors.js';
import { createLogger } from './utils/logger.js';
import type { PreProcessor, ProcessorContext } from './types/index.js';

type OptionalEnabledPreProcessor = PreProcessor & {
  enabled?: (context: ProcessorContext) => boolean;
};

const logger = createLogger('pipeline');

export class PreProcessorManager {
  private processors: OptionalEnabledPreProcessor[] = [];

  register(processor: PreProcessor): void {
    this.processors.push(processor as OptionalEnabledPreProcessor);
  }

  getProcessors(): PreProcessor[] {
    return [...this.processors];
  }

  async process(context: ProcessorContext): Promise<ProcessorContext> {
    let current = context;

    for (const processor of this.processors) {
      try {
        const isEnabled = processor.enabled?.(current) ?? true;
        if (!isEnabled) {
          continue;
        }

        current = await processor.process(current);
      } catch (error) {
        const originalError = error instanceof Error ? error : new Error(String(error));
        const wrappedError = new ProcessorError(processor.name, originalError, {
          targetUrl: current.targetUrl,
          apiFormat: current.apiFormat,
        });

        logger.warn('processor failed, continue with next', {
          processorName: processor.name,
          errorName: wrappedError.name,
          errorMessage: wrappedError.message,
        });
      }
    }

    return current;
  }
}
