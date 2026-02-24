import { describe, test, expect } from 'bun:test';
import type { AppConfig } from '../src/types/index.js';
import { createProcessorRegistry } from '../src/registry.js';
import { DEFAULT_CONFIG } from '../src/config.js';

const baseConfig: AppConfig = {
  server: {
    port: 3000,
    host: '0.0.0.0',
    maxPayloadSize: '50mb',
  },
  processors: {
    image: {
      enabled: true,
      output: {
        format: 'webp',
        quality: 80,
        effort: 4,
      },
      resize: {
        maxWidth: 2048,
        maxHeight: 2048,
      },
    },
  },
  logging: {
    level: 'info',
    format: 'json',
  },
};

describe('createProcessorRegistry', () => {
  test('image processor enabled → pipeline has 1 processor named imageProcessor', () => {
    const config: AppConfig = {
      ...baseConfig,
      processors: {
        image: { ...baseConfig.processors.image, enabled: true },
      },
    };

    const manager = createProcessorRegistry(config);
    const processors = manager.getProcessors();

    expect(processors).toHaveLength(1);
    expect(processors[0]?.name).toBe('imageProcessor');
  });

  test('image processor disabled → pipeline has 0 processors', () => {
    const config: AppConfig = {
      ...baseConfig,
      processors: {
        image: { ...baseConfig.processors.image, enabled: false },
      },
    };

    const manager = createProcessorRegistry(config);
    const processors = manager.getProcessors();

    expect(processors).toHaveLength(0);
  });

  test('default config → processor registered (default enabled=true)', () => {
    const manager = createProcessorRegistry(DEFAULT_CONFIG);
    const processors = manager.getProcessors();

    expect(processors).toHaveLength(1);
    expect(processors[0]?.name).toBe('imageProcessor');
  });

  test('returns a new PreProcessorManager instance each call', () => {
    const manager1 = createProcessorRegistry(baseConfig);
    const manager2 = createProcessorRegistry(baseConfig);

    expect(manager1).not.toBe(manager2);
  });
});
