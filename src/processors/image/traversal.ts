import type { ApiFormat } from '../../types/index.js';
import { buildDataUri, detectMimeType, isBase64Image, parseDataUri } from '../../utils/base64.js';
import { isSupportedImageMime } from '../../utils/mime.js';

export interface ImageNode {
  base64: string;
  mimeType: string;
  path: string;
  format: ApiFormat;
}

type JsonRecord = Record<string, unknown>;

const DATA_SUFFIX = '.data';

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null;
}

function readArray(record: JsonRecord, key: string): unknown[] | null {
  const value = record[key];
  return Array.isArray(value) ? value : null;
}

function readString(record: JsonRecord, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' ? value : null;
}

function readRecord(record: JsonRecord, key: string): JsonRecord | null {
  const value = record[key];
  return isJsonRecord(value) ? value : null;
}

function resolveMimeType(base64: string, declaredMimeType?: string): string | null {
  if (!isBase64Image(base64)) {
    return null;
  }

  if (declaredMimeType !== undefined && !isSupportedImageMime(declaredMimeType)) {
    return null;
  }

  const detectedMimeType = detectMimeType(base64);
  if (detectedMimeType && isSupportedImageMime(detectedMimeType)) {
    return detectedMimeType;
  }

  if (declaredMimeType && isSupportedImageMime(declaredMimeType)) {
    return declaredMimeType;
  }

  return null;
}

function pushRawNode(
  nodes: ImageNode[],
  format: ApiFormat,
  path: string,
  base64: string,
  declaredMimeType?: string,
): void {
  const mimeType = resolveMimeType(base64, declaredMimeType);
  if (!mimeType) {
    return;
  }

  nodes.push({
    base64,
    mimeType,
    path,
    format,
  });
}

function pushDataUriNode(nodes: ImageNode[], format: ApiFormat, path: string, dataUri: string): void {
  const parsed = parseDataUri(dataUri);
  if (!parsed) {
    return;
  }

  pushRawNode(nodes, format, path, parsed.base64Data, parsed.mimeType);
}

function collectOpenAIChatContent(content: unknown, contentPath: string, nodes: ImageNode[]): void {
  if (!Array.isArray(content)) {
    return;
  }

  for (let index = 0; index < content.length; index += 1) {
    const part = content[index];
    if (!isJsonRecord(part)) {
      continue;
    }

    const partPath = `${contentPath}[${index}]`;
    const partType = readString(part, 'type');

    if (partType === 'image_url') {
      const imageUrl = readRecord(part, 'image_url');
      const url = imageUrl ? readString(imageUrl, 'url') : null;
      if (url) {
        pushDataUriNode(nodes, 'openai-chat', `${partPath}.image_url.url`, url);
      }
    }

    const nestedContent = readArray(part, 'content');
    if (nestedContent) {
      collectOpenAIChatContent(nestedContent, `${partPath}.content`, nodes);
    }

    const functionResponse = readRecord(part, 'functionResponse');
    if (functionResponse) {
      const response = readRecord(functionResponse, 'response');
      const responseContent = response ? readArray(response, 'content') : null;
      if (responseContent) {
        collectOpenAIChatContent(responseContent, `${partPath}.functionResponse.response.content`, nodes);
      }
    }

    const response = readRecord(part, 'response');
    if (response) {
      const responseContent = readArray(response, 'content');
      if (responseContent) {
        collectOpenAIChatContent(responseContent, `${partPath}.response.content`, nodes);
      }
    }
  }
}

function collectOpenAIResponsesContent(content: unknown, contentPath: string, nodes: ImageNode[]): void {
  if (!Array.isArray(content)) {
    return;
  }

  for (let index = 0; index < content.length; index += 1) {
    const part = content[index];
    if (!isJsonRecord(part)) {
      continue;
    }

    const partPath = `${contentPath}[${index}]`;
    const partType = readString(part, 'type');

    if (partType === 'input_image') {
      const imageUrl = readString(part, 'image_url');
      if (imageUrl) {
        pushDataUriNode(nodes, 'openai-responses', `${partPath}.image_url`, imageUrl);
      }
    }

    const nestedContent = readArray(part, 'content');
    if (nestedContent) {
      collectOpenAIResponsesContent(nestedContent, `${partPath}.content`, nodes);
    }

    const functionResponse = readRecord(part, 'functionResponse');
    if (functionResponse) {
      const response = readRecord(functionResponse, 'response');
      const responseContent = response ? readArray(response, 'content') : null;
      if (responseContent) {
        collectOpenAIResponsesContent(responseContent, `${partPath}.functionResponse.response.content`, nodes);
      }
    }

    const response = readRecord(part, 'response');
    if (response) {
      const responseContent = readArray(response, 'content');
      if (responseContent) {
        collectOpenAIResponsesContent(responseContent, `${partPath}.response.content`, nodes);
      }
    }
  }
}

function collectAnthropicContent(content: unknown, contentPath: string, nodes: ImageNode[]): void {
  if (!Array.isArray(content)) {
    return;
  }

  for (let index = 0; index < content.length; index += 1) {
    const part = content[index];
    if (!isJsonRecord(part)) {
      continue;
    }

    const partPath = `${contentPath}[${index}]`;
    const partType = readString(part, 'type');

    if (partType === 'image') {
      const source = readRecord(part, 'source');
      const base64 = source ? readString(source, 'data') : null;
      const mimeType = source ? readString(source, 'media_type') : null;
      if (base64 && mimeType) {
        pushRawNode(nodes, 'anthropic', `${partPath}.source.data`, base64, mimeType);
      }
    }

    const nestedContent = readArray(part, 'content');
    if (nestedContent) {
      collectAnthropicContent(nestedContent, `${partPath}.content`, nodes);
    }

    const response = readRecord(part, 'response');
    if (response) {
      const responseContent = readArray(response, 'content');
      if (responseContent) {
        collectAnthropicContent(responseContent, `${partPath}.response.content`, nodes);
      }
    }
  }
}

function collectGeminiParts(parts: unknown, partsPath: string, nodes: ImageNode[]): void {
  if (!Array.isArray(parts)) {
    return;
  }

  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    if (!isJsonRecord(part)) {
      continue;
    }

    const partPath = `${partsPath}[${index}]`;

    const inlineData = readRecord(part, 'inlineData');
    if (inlineData) {
      const base64 = readString(inlineData, 'data');
      const mimeType = readString(inlineData, 'mimeType');
      if (base64 && mimeType) {
        pushRawNode(nodes, 'gemini', `${partPath}.inlineData.data`, base64, mimeType);
      }
    }

    const nestedParts = readArray(part, 'parts');
    if (nestedParts) {
      collectGeminiParts(nestedParts, `${partPath}.parts`, nodes);
    }

    const nestedContent = readArray(part, 'content');
    if (nestedContent) {
      collectGeminiParts(nestedContent, `${partPath}.content`, nodes);
    }

    const functionResponse = readRecord(part, 'functionResponse');
    if (functionResponse) {
      const response = readRecord(functionResponse, 'response');
      const responseContent = response ? readArray(response, 'content') : null;
      if (responseContent) {
        collectGeminiParts(responseContent, `${partPath}.functionResponse.response.content`, nodes);
      }
    }

    const response = readRecord(part, 'response');
    if (response) {
      const responseContent = readArray(response, 'content');
      if (responseContent) {
        collectGeminiParts(responseContent, `${partPath}.response.content`, nodes);
      }
    }
  }
}

export function findImageNodes(body: unknown, format: ApiFormat): ImageNode[] {
  if (!isJsonRecord(body)) {
    return [];
  }

  const nodes: ImageNode[] = [];

  switch (format) {
    case 'openai-chat': {
      const messages = readArray(body, 'messages');
      if (!messages) {
        return nodes;
      }

      for (let index = 0; index < messages.length; index += 1) {
        const message = messages[index];
        if (!isJsonRecord(message)) {
          continue;
        }

        const content = readArray(message, 'content');
        if (content) {
          collectOpenAIChatContent(content, `messages[${index}].content`, nodes);
        }
      }

      return nodes;
    }

    case 'openai-responses': {
      const input = readArray(body, 'input');
      if (!input) {
        return nodes;
      }

      for (let index = 0; index < input.length; index += 1) {
        const item = input[index];
        if (!isJsonRecord(item)) {
          continue;
        }

        const content = readArray(item, 'content');
        if (content) {
          collectOpenAIResponsesContent(content, `input[${index}].content`, nodes);
        }
      }

      return nodes;
    }

    case 'anthropic': {
      const messages = readArray(body, 'messages');
      if (!messages) {
        return nodes;
      }

      for (let index = 0; index < messages.length; index += 1) {
        const message = messages[index];
        if (!isJsonRecord(message)) {
          continue;
        }

        const content = readArray(message, 'content');
        if (content) {
          collectAnthropicContent(content, `messages[${index}].content`, nodes);
        }
      }

      return nodes;
    }

    case 'gemini': {
      const contents = readArray(body, 'contents');
      if (!contents) {
        return nodes;
      }

      for (let index = 0; index < contents.length; index += 1) {
        const content = contents[index];
        if (!isJsonRecord(content)) {
          continue;
        }

        const parts = readArray(content, 'parts');
        if (parts) {
          collectGeminiParts(parts, `contents[${index}].parts`, nodes);
        }
      }

      return nodes;
    }

    default:
      return nodes;
  }
}

function parsePath(path: string): Array<string | number> {
  const segments: Array<string | number> = [];
  const matcher = /([^[.\]]+)|\[(\d+)\]/g;

  for (const match of path.matchAll(matcher)) {
    const key = match[1];
    if (key !== undefined) {
      segments.push(key);
      continue;
    }

    const indexText = match[2];
    if (indexText !== undefined) {
      segments.push(Number.parseInt(indexText, 10));
    }
  }

  return segments;
}

function setValueAtPath(root: unknown, path: string, value: unknown): boolean {
  const segments = parsePath(path);
  if (segments.length === 0) {
    return false;
  }

  let current: unknown = root;

  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index];
    if (segment === undefined) {
      return false;
    }

    if (typeof segment === 'number') {
      if (!Array.isArray(current)) {
        return false;
      }

      current = current[segment];
    } else {
      if (!isJsonRecord(current)) {
        return false;
      }

      current = current[segment];
    }

    if (current === undefined || current === null) {
      return false;
    }
  }

  const finalSegment = segments[segments.length - 1];
  if (finalSegment === undefined) {
    return false;
  }

  if (typeof finalSegment === 'number') {
    if (!Array.isArray(current)) {
      return false;
    }

    current[finalSegment] = value;
    return true;
  }

  if (!isJsonRecord(current)) {
    return false;
  }

  current[finalSegment] = value;
  return true;
}

export function replaceImageNode(
  body: unknown,
  node: ImageNode,
  newBase64: string,
  newMimeType: string,
): void {
  switch (node.format) {
    case 'openai-chat':
    case 'openai-responses': {
      setValueAtPath(body, node.path, buildDataUri(newMimeType, newBase64));
      return;
    }

    case 'anthropic': {
      setValueAtPath(body, node.path, newBase64);
      if (node.path.endsWith(DATA_SUFFIX)) {
        const mimePath = `${node.path.slice(0, -DATA_SUFFIX.length)}.media_type`;
        setValueAtPath(body, mimePath, newMimeType);
      }
      return;
    }

    case 'gemini': {
      setValueAtPath(body, node.path, newBase64);
      if (node.path.endsWith(DATA_SUFFIX)) {
        const mimePath = `${node.path.slice(0, -DATA_SUFFIX.length)}.mimeType`;
        setValueAtPath(body, mimePath, newMimeType);
      }
      return;
    }

    default:
      return;
  }
}
