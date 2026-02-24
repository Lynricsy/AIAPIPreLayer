/**
 * AI API PreLayer — API 请求格式类型定义
 * 涵盖 OpenAI Chat, OpenAI Responses, Anthropic, Gemini 四种格式
 */

// =====================
// OpenAI Chat Completions
// =====================

export interface OpenAIChatTextContent {
  type: 'text';
  text: string;
}

export interface OpenAIChatImageContent {
  type: 'image_url';
  image_url: {
    url: string;
    detail?: 'auto' | 'low' | 'high';
  };
}

export type OpenAIChatContentPart = OpenAIChatTextContent | OpenAIChatImageContent;

export interface OpenAIChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | OpenAIChatContentPart[];
  tool_call_id?: string;
  name?: string;
}

export interface OpenAIChatRequest {
  model: string;
  messages: OpenAIChatMessage[];
  max_tokens?: number;
  temperature?: number;
  stream?: boolean;
  [key: string]: unknown;
}

// =====================
// OpenAI Responses API
// =====================

export interface OpenAIResponsesInputText {
  type: 'input_text';
  text: string;
}

export interface OpenAIResponsesInputImage {
  type: 'input_image';
  image_url: string;
  detail?: 'auto' | 'low' | 'high';
}

export interface OpenAIResponsesOutputText {
  type: 'output_text';
  text: string;
}

export type OpenAIResponsesContentPart =
  | OpenAIResponsesInputText
  | OpenAIResponsesInputImage
  | OpenAIResponsesOutputText;

export interface OpenAIResponsesMessage {
  type?: 'message';
  role: 'user' | 'assistant' | 'system';
  content: OpenAIResponsesContentPart[];
}

export interface OpenAIResponsesToolResult {
  type: 'tool_result';
  tool_use_id: string;
  content: OpenAIResponsesContentPart[];
}

export type OpenAIResponsesInputItem = OpenAIResponsesMessage | OpenAIResponsesToolResult;

export interface OpenAIResponsesRequest {
  model: string;
  input: OpenAIResponsesInputItem[];
  max_output_tokens?: number;
  temperature?: number;
  stream?: boolean;
  [key: string]: unknown;
}

// =====================
// Anthropic Messages
// =====================

export interface AnthropicTextContent {
  type: 'text';
  text: string;
}

export interface AnthropicImageSource {
  type: 'base64';
  media_type: string;
  data: string;
}

export interface AnthropicImageContent {
  type: 'image';
  source: AnthropicImageSource;
}

export interface AnthropicToolResultContent {
  type: 'tool_result';
  tool_use_id: string;
  content: Array<AnthropicTextContent | AnthropicImageContent>;
}

export type AnthropicContentPart =
  | AnthropicTextContent
  | AnthropicImageContent
  | AnthropicToolResultContent;

export interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | AnthropicContentPart[];
}

export interface AnthropicMessagesRequest {
  model: string;
  max_tokens: number;
  messages: AnthropicMessage[];
  system?: string;
  temperature?: number;
  stream?: boolean;
  [key: string]: unknown;
}

// =====================
// Gemini GenerateContent
// =====================

export interface GeminiTextPart {
  text: string;
}

export interface GeminiInlineData {
  mimeType: string;
  data: string;
}

export interface GeminiInlineDataPart {
  inlineData: GeminiInlineData;
}

export interface GeminiFunctionResponse {
  name: string;
  response: Record<string, unknown>;
}

export interface GeminiFunctionResponsePart {
  functionResponse: GeminiFunctionResponse;
}

export type GeminiPart = GeminiTextPart | GeminiInlineDataPart | GeminiFunctionResponsePart;

export interface GeminiContent {
  role?: 'user' | 'model';
  parts: GeminiPart[];
}

export interface GeminiGenerationConfig {
  maxOutputTokens?: number;
  temperature?: number;
  topP?: number;
  topK?: number;
}

export interface GeminiGenerateRequest {
  contents: GeminiContent[];
  generationConfig?: GeminiGenerationConfig;
  [key: string]: unknown;
}
