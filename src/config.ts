import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import type {
  AppConfig,
  ServerConfig,
  ProcessorsConfig,
  ImageProcessorConfig,
  ImageOutputConfig,
  ImageResizeConfig,
  LoggingConfig,
  EncryptedReasoningProcessorConfig,
} from './types/index.ts';

export const DEFAULT_CONFIG: AppConfig = {
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
    encryptedReasoning: {
      enabled: true,
      maxRetries: 2,
      preambleTimeoutMs: 5000,
    },
  },
  logging: {
    level: 'info',
    format: 'json',
  },
};

function validatePort(port: number): void {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`无效的端口号: ${port}，端口必须在 1-65535 范围内`);
  }
}

function validateQuality(quality: number): void {
  if (!Number.isInteger(quality) || quality < 0 || quality > 100) {
    throw new Error(`无效的 quality 值: ${quality}，quality 必须在 0-100 范围内`);
  }
}

function validateEffort(effort: number): void {
  if (!Number.isInteger(effort) || effort < 0 || effort > 6) {
    throw new Error(`无效的 effort 值: ${effort}，effort 必须在 0-6 范围内`);
  }
}

function validateMaxPayloadSize(size: string): void {
  if (!size || size.trim() === '') {
    throw new Error('maxPayloadSize 不能为空字符串');
  }
}

function getStr(obj: unknown, key: string): string | undefined {
  if (typeof obj === 'object' && obj !== null && key in obj) {
    const val = (obj as Record<string, unknown>)[key];
    return typeof val === 'string' ? val : undefined;
  }
  return undefined;
}

function getNum(obj: unknown, key: string): number | undefined {
  if (typeof obj === 'object' && obj !== null && key in obj) {
    const val = (obj as Record<string, unknown>)[key];
    return typeof val === 'number' ? val : undefined;
  }
  return undefined;
}

function getBool(obj: unknown, key: string): boolean | undefined {
  if (typeof obj === 'object' && obj !== null && key in obj) {
    const val = (obj as Record<string, unknown>)[key];
    return typeof val === 'boolean' ? val : undefined;
  }
  return undefined;
}

function getObj(obj: unknown, key: string): unknown {
  if (typeof obj === 'object' && obj !== null && key in obj) {
    return (obj as Record<string, unknown>)[key];
  }
  return undefined;
}

function parseImageOutputConfig(raw: unknown): ImageOutputConfig {
  const def = DEFAULT_CONFIG.processors.image.output;
  const quality = getNum(raw, 'quality') ?? def.quality;
  const effort = getNum(raw, 'effort') ?? def.effort;
  validateQuality(quality);
  validateEffort(effort);
  return { format: 'webp', quality, effort };
}

function parseImageResizeConfig(raw: unknown): ImageResizeConfig {
  const def = DEFAULT_CONFIG.processors.image.resize;
  return {
    maxWidth: getNum(raw, 'maxWidth') ?? def.maxWidth,
    maxHeight: getNum(raw, 'maxHeight') ?? def.maxHeight,
  };
}

function parseImageProcessorConfig(raw: unknown): ImageProcessorConfig {
  const def = DEFAULT_CONFIG.processors.image;
  return {
    enabled: getBool(raw, 'enabled') ?? def.enabled,
    output: parseImageOutputConfig(getObj(raw, 'output')),
    resize: parseImageResizeConfig(getObj(raw, 'resize')),
  };
}

function validateMaxRetries(value: number): void {
  if (!Number.isInteger(value) || value < 1 || value > 5) {
    throw new Error(`无效的 maxRetries 值: ${value}，maxRetries 必须在 1-5 范围内`);
  }
}

function validatePreambleTimeoutMs(value: number): void {
  if (!Number.isInteger(value) || value < 1000 || value > 30000) {
    throw new Error(`无效的 preambleTimeoutMs 值: ${value}，preambleTimeoutMs 必须在 1000-30000 范围内`);
  }
}

function parseEncryptedReasoningConfig(raw: unknown): EncryptedReasoningProcessorConfig {
  const def = DEFAULT_CONFIG.processors.encryptedReasoning;
  const maxRetries = getNum(raw, 'maxRetries') ?? def.maxRetries;
  const preambleTimeoutMs = getNum(raw, 'preambleTimeoutMs') ?? def.preambleTimeoutMs;
  validateMaxRetries(maxRetries);
  validatePreambleTimeoutMs(preambleTimeoutMs);
  return {
    enabled: getBool(raw, 'enabled') ?? def.enabled,
    maxRetries,
    preambleTimeoutMs,
  };
}

function parseProcessorsConfig(raw: unknown): ProcessorsConfig {
  return {
    image: parseImageProcessorConfig(getObj(raw, 'image')),
    encryptedReasoning: parseEncryptedReasoningConfig(getObj(raw, 'encryptedReasoning')),
  };
}

function parseServerConfig(raw: unknown): ServerConfig {
  const def = DEFAULT_CONFIG.server;
  const port = getNum(raw, 'port') ?? def.port;
  const maxPayloadSize = getStr(raw, 'maxPayloadSize') ?? def.maxPayloadSize;
  validatePort(port);
  validateMaxPayloadSize(maxPayloadSize);
  return { port, host: getStr(raw, 'host') ?? def.host, maxPayloadSize };
}

function parseLoggingConfig(raw: unknown): LoggingConfig {
  const def = DEFAULT_CONFIG.logging;
  const levelRaw = getStr(raw, 'level') ?? def.level;
  const formatRaw = getStr(raw, 'format') ?? def.format;

  const validLevels = ['debug', 'info', 'warn', 'error'] as const;
  const validFormats = ['json', 'text'] as const;

  const level = (validLevels as readonly string[]).includes(levelRaw)
    ? (levelRaw as LoggingConfig['level'])
    : def.level;
  const format = (validFormats as readonly string[]).includes(formatRaw)
    ? (formatRaw as LoggingConfig['format'])
    : def.format;

  return { level, format };
}

function parseAppConfig(raw: unknown): AppConfig {
  return {
    server: parseServerConfig(getObj(raw, 'server')),
    processors: parseProcessorsConfig(getObj(raw, 'processors')),
    logging: parseLoggingConfig(getObj(raw, 'logging')),
  };
}

function applyEnvOverrides(config: AppConfig): AppConfig {
  const portEnv = process.env['AIAPL_PORT'];
  const hostEnv = process.env['AIAPL_HOST'];

  let port = config.server.port;
  if (portEnv !== undefined) {
    const parsed = parseInt(portEnv, 10);
    if (isNaN(parsed)) {
      throw new Error(`环境变量 AIAPL_PORT 值无效: "${portEnv}"，必须是整数`);
    }
    port = parsed;
  }

  const host = hostEnv ?? config.server.host;
  validatePort(port);

  return {
    ...config,
    server: { ...config.server, port, host },
  };
}

export function loadConfig(configPath?: string): AppConfig {
  const filePath = configPath ?? './config.yaml';

  let raw: unknown = undefined;

  try {
    const content = readFileSync(filePath, 'utf-8');
    raw = parseYaml(content);
  } catch {
    raw = undefined;
  }

  const parsed = raw !== undefined ? parseAppConfig(raw) : { ...DEFAULT_CONFIG };
  return applyEnvOverrides(parsed);
}
