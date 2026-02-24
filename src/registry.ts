import type { AppConfig } from './types/index.ts';
import { PreProcessorManager } from './pipeline.ts';
import { ImageProcessor } from './processors/image/index.ts';
import { createLogger } from './utils/logger.ts';

const logger = createLogger('registry');

export function createProcessorRegistry(config: AppConfig): PreProcessorManager {
  const manager = new PreProcessorManager();

  if (config.processors.image.enabled) {
    const imageProcessor = new ImageProcessor(config.processors.image);
    manager.register(imageProcessor);
    logger.info('Registered processor: imageProcessor', {
      processorName: 'imageProcessor',
    });
  }

  return manager;
}
