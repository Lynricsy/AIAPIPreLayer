import type { AppConfig } from './types/index.ts';
import { PreProcessorManager } from './pipeline.ts';
import { ImageProcessor } from './processors/image/index.ts';
import { ServiceTierProcessor } from './processors/service-tier.ts';
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

  if (config.processors.serviceTier.enabled) {
    const serviceTierProcessor = new ServiceTierProcessor(config.processors.serviceTier);
    manager.register(serviceTierProcessor);
    logger.info('Registered processor: serviceTierProcessor', {
      processorName: 'serviceTierProcessor',
    });
  }

  return manager;
}
