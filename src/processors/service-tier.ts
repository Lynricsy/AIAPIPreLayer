/**
 * Service Tier 处理器
 *
 * 为 OpenAI Responses API 请求注入 service_tier 字段，
 * 以启用优先级处理队列。
 */

import type { PreProcessor, ProcessorContext, ServiceTierProcessorConfig } from '../types/index.ts';
import { createLogger } from '../utils/logger.ts';

const logger = createLogger('service-tier-processor');

export class ServiceTierProcessor implements PreProcessor {
  readonly name = 'serviceTierProcessor';
  private readonly config: ServiceTierProcessorConfig;

  constructor(config: ServiceTierProcessorConfig) {
    this.config = config;
  }

  async process(context: ProcessorContext): Promise<ProcessorContext> {
    if (context.apiFormat !== 'openai-responses') {
      return context;
    }

    const body = context.requestBody;
    if (typeof body !== 'object' || body === null) {
      return context;
    }

    const modified = { ...(body as Record<string, unknown>), service_tier: this.config.value };

    logger.debug('Injected service_tier into responses request', {
      service_tier: this.config.value,
    });

    return { ...context, requestBody: modified };
  }
}
