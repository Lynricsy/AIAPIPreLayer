/**
 * AI API PreLayer — 核心类型定义
 */

// =====================
// API 格式枚举
// =====================

/** 支持的 API 格式 */
export type ApiFormat =
  | 'openai-chat'
  | 'openai-responses'
  | 'anthropic'
  | 'gemini'
  | 'unknown';

// =====================
// 配置类型
// =====================

/** 图片输出配置 */
export interface ImageOutputConfig {
  format: 'webp';
  quality: number;
  effort: number;
}

/** 图片尺寸限制配置 */
export interface ImageResizeConfig {
  maxWidth: number;
  maxHeight: number;
}

/** 图片处理器配置 */
export interface ImageProcessorConfig {
  enabled: boolean;
  output: ImageOutputConfig;
  resize: ImageResizeConfig;
}

/** 服务器配置 */
export interface ServerConfig {
  port: number;
  host: string;
  maxPayloadSize: string;
}

/** 日志配置 */
export interface LoggingConfig {
  level: 'debug' | 'info' | 'warn' | 'error';
  format: 'json' | 'text';
}

/** 加密推理重试处理器配置 */
export interface EncryptedReasoningProcessorConfig {
  enabled: boolean;
  maxRetries: number;
  preambleTimeoutMs: number;
}

/** 处理器配置 */
export interface ProcessorsConfig {
  image: ImageProcessorConfig;
  encryptedReasoning: EncryptedReasoningProcessorConfig;
}

/** 应用整体配置 */
export interface AppConfig {
  server: ServerConfig;
  processors: ProcessorsConfig;
  logging: LoggingConfig;
}

// =====================
// 路由目标类型
// =====================

/** 路由目标信息 */
export interface RouteTarget {
  targetUrl: string;
  protocol: string;
  host: string;
  path: string;
}

// =====================
// 预处理器类型
// =====================

/** 预处理器上下文 */
export interface ProcessorContext {
  requestBody: unknown;
  apiFormat: ApiFormat;
  targetUrl: string;
  headers: Record<string, string>;
  config: AppConfig;
}

/** 预处理器接口 */
export interface PreProcessor {
  name: string;
  process(context: ProcessorContext): Promise<ProcessorContext>;
}

// =====================
// 后处理器类型
// =====================

/** 后处理器上下文 */
export interface PostProcessorContext {
  responseBody: unknown;
  apiFormat: ApiFormat;
  targetUrl: string;
  headers: Record<string, string>;
  config: AppConfig;
}

/** 后处理器接口 */
export interface PostProcessor {
  name: string;
  process(context: PostProcessorContext): Promise<PostProcessorContext>;
}
