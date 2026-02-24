import { describe, expect, test } from 'bun:test';
import type {
  AnthropicMessagesRequest,
  GeminiGenerateRequest,
  OpenAIChatRequest,
  OpenAIResponsesRequest,
} from '../src/types/api-formats.js';
import { buildDataUri } from '../src/utils/base64.js';
import { findImageNodes, replaceImageNode } from '../src/processors/image/traversal.js';

const REPLACED_BASE64 = 'ZmFrZV9pbWFnZV9kYXRh';
const REPLACED_MIME = 'image/webp';

async function loadFixture<T>(fileName: string): Promise<T> {
  const fixtureUrl = new URL(`./fixtures/${fileName}`, import.meta.url);
  return (await Bun.file(fixtureUrl).json()) as T;
}

describe('findImageNodes: openai-chat', () => {
  test('finds image_url nodes from normal and tool message content', async () => {
    const body = await loadFixture<OpenAIChatRequest>('openai-chat.json');
    const nodes = findImageNodes(body, 'openai-chat');

    expect(nodes.length).toBe(2);
    expect(nodes[0]?.path).toBe('messages[0].content[1].image_url.url');
    expect(nodes[1]?.path).toBe('messages[2].content[1].image_url.url');
    expect(nodes.every((node) => node.format === 'openai-chat')).toBe(true);
    expect(nodes.every((node) => node.mimeType === 'image/png')).toBe(true);
  });

  test('skips URL-based image_url values', async () => {
    const body = await loadFixture<OpenAIChatRequest>('openai-chat.json');
    const firstMessage = body.messages[0];
    if (firstMessage && Array.isArray(firstMessage.content)) {
      const imagePart = firstMessage.content[1];
      if (imagePart && imagePart.type === 'image_url') {
        imagePart.image_url.url = 'https://example.com/remote-image.png';
      }
    }

    const nodes = findImageNodes(body, 'openai-chat');
    expect(nodes.length).toBe(1);
    expect(nodes[0]?.path).toBe('messages[2].content[1].image_url.url');
  });

  test('replaceImageNode rebuilds data URI at image_url.url', async () => {
    const body = await loadFixture<OpenAIChatRequest>('openai-chat.json');
    const nodes = findImageNodes(body, 'openai-chat');
    const target = nodes[0];

    expect(target).toBeDefined();
    if (!target) {
      throw new Error('missing openai-chat image node');
    }

    replaceImageNode(body, target, REPLACED_BASE64, REPLACED_MIME);

    const firstMessage = body.messages[0];
    if (!firstMessage || !Array.isArray(firstMessage.content)) {
      throw new Error('missing openai-chat content array');
    }

    const imagePart = firstMessage.content[1];
    if (!imagePart || imagePart.type !== 'image_url') {
      throw new Error('missing openai-chat image part');
    }

    expect(imagePart.image_url.url).toBe(buildDataUri(REPLACED_MIME, REPLACED_BASE64));
  });
});

describe('findImageNodes: openai-responses', () => {
  test('finds input_image nodes from user and tool_result content arrays', async () => {
    const body = await loadFixture<OpenAIResponsesRequest>('openai-responses.json');
    const nodes = findImageNodes(body, 'openai-responses');

    expect(nodes.length).toBe(2);
    expect(nodes[0]?.path).toBe('input[0].content[1].image_url');
    expect(nodes[1]?.path).toBe('input[2].content[1].image_url');
    expect(nodes.every((node) => node.format === 'openai-responses')).toBe(true);
  });

  test('skips unsupported MIME types in OpenAI data URIs', async () => {
    const body = await loadFixture<OpenAIResponsesRequest>('openai-responses.json');

    for (const item of body.input) {
      if (!Array.isArray(item.content)) {
        continue;
      }

      for (const part of item.content) {
        if (part.type === 'input_image') {
          part.image_url = part.image_url.replace('data:image/png;', 'data:image/bmp;');
        }
      }
    }

    const nodes = findImageNodes(body, 'openai-responses');
    expect(nodes.length).toBe(0);
  });

  test('replaceImageNode updates flat image_url field', async () => {
    const body = await loadFixture<OpenAIResponsesRequest>('openai-responses.json');
    const nodes = findImageNodes(body, 'openai-responses');
    const target = nodes[0];

    expect(target).toBeDefined();
    if (!target) {
      throw new Error('missing openai-responses image node');
    }

    replaceImageNode(body, target, REPLACED_BASE64, REPLACED_MIME);

    const firstInput = body.input[0];
    if (!firstInput || !Array.isArray(firstInput.content)) {
      throw new Error('missing openai-responses content array');
    }

    const imagePart = firstInput.content[1];
    if (!imagePart || imagePart.type !== 'input_image') {
      throw new Error('missing openai-responses input_image part');
    }

    expect(imagePart.image_url).toBe(buildDataUri(REPLACED_MIME, REPLACED_BASE64));
  });
});

describe('findImageNodes: anthropic', () => {
  test('finds image nodes from message content and tool_result.content', async () => {
    const body = await loadFixture<AnthropicMessagesRequest>('anthropic-messages.json');
    const nodes = findImageNodes(body, 'anthropic');

    expect(nodes.length).toBe(2);
    expect(nodes[0]?.path).toBe('messages[0].content[1].source.data');
    expect(nodes[1]?.path).toBe('messages[2].content[0].content[1].source.data');
    expect(nodes.every((node) => node.mimeType === 'image/png')).toBe(true);
  });

  test('skips non-base64 source.data values', async () => {
    const body = await loadFixture<AnthropicMessagesRequest>('anthropic-messages.json');
    const firstMessage = body.messages[0];
    if (firstMessage && Array.isArray(firstMessage.content)) {
      const imagePart = firstMessage.content[1];
      if (imagePart && imagePart.type === 'image') {
        imagePart.source.data = 'https://example.com/not-base64.png';
      }
    }

    const nodes = findImageNodes(body, 'anthropic');
    expect(nodes.length).toBe(1);
    expect(nodes[0]?.path).toBe('messages[2].content[0].content[1].source.data');
  });

  test('supports mixed-content fixture with three anthropic images', async () => {
    const body = await loadFixture<AnthropicMessagesRequest>('mixed-content.json');
    const nodes = findImageNodes(body, 'anthropic');

    expect(nodes.length).toBe(3);
    expect(nodes[2]?.path).toBe('messages[2].content[0].content[1].source.data');
  });

  test('replaceImageNode updates source.data and source.media_type', async () => {
    const body = await loadFixture<AnthropicMessagesRequest>('anthropic-messages.json');
    const nodes = findImageNodes(body, 'anthropic');
    const target = nodes[0];

    expect(target).toBeDefined();
    if (!target) {
      throw new Error('missing anthropic image node');
    }

    replaceImageNode(body, target, REPLACED_BASE64, REPLACED_MIME);

    const firstMessage = body.messages[0];
    if (!firstMessage || !Array.isArray(firstMessage.content)) {
      throw new Error('missing anthropic content array');
    }

    const imagePart = firstMessage.content[1];
    if (!imagePart || imagePart.type !== 'image') {
      throw new Error('missing anthropic image part');
    }

    expect(imagePart.source.data).toBe(REPLACED_BASE64);
    expect(imagePart.source.media_type).toBe(REPLACED_MIME);
  });
});

describe('findImageNodes: gemini', () => {
  test('finds inlineData images in regular parts arrays', async () => {
    const body = await loadFixture<GeminiGenerateRequest>('gemini-generate.json');
    const nodes = findImageNodes(body, 'gemini');

    expect(nodes.length).toBe(2);
    expect(nodes[0]?.path).toBe('contents[0].parts[1].inlineData.data');
    expect(nodes[1]?.path).toBe('contents[2].parts[1].inlineData.data');
    expect(nodes.every((node) => node.format === 'gemini')).toBe(true);
  });

  test('finds inlineData inside functionResponse.response.content arrays', async () => {
    const body = await loadFixture<GeminiGenerateRequest>('gemini-generate.json');

    const candidateBase64 =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';
    const userContent = body.contents[2];
    const functionPart = userContent?.parts[0];
    if (functionPart && 'functionResponse' in functionPart) {
      functionPart.functionResponse.response['content'] = [
        {
          inlineData: {
            mimeType: 'image/png',
            data: candidateBase64,
          },
        },
      ];
    }

    const nodes = findImageNodes(body, 'gemini');
    expect(nodes.length).toBe(3);
    expect(
      nodes.some(
        (node) => node.path === 'contents[2].parts[0].functionResponse.response.content[0].inlineData.data',
      ),
    ).toBe(true);
  });

  test('replaceImageNode updates inlineData.data and inlineData.mimeType', async () => {
    const body = await loadFixture<GeminiGenerateRequest>('gemini-generate.json');
    const nodes = findImageNodes(body, 'gemini');
    const target = nodes[0];

    expect(target).toBeDefined();
    if (!target) {
      throw new Error('missing gemini image node');
    }

    replaceImageNode(body, target, REPLACED_BASE64, REPLACED_MIME);

    const firstContent = body.contents[0];
    const imagePart = firstContent?.parts[1];
    if (!imagePart || !('inlineData' in imagePart)) {
      throw new Error('missing gemini inlineData part');
    }

    expect(imagePart.inlineData.data).toBe(REPLACED_BASE64);
    expect(imagePart.inlineData.mimeType).toBe(REPLACED_MIME);
  });
});

describe('findImageNodes: edge cases', () => {
  test('returns empty list when no image payload exists', async () => {
    const body = await loadFixture<OpenAIChatRequest>('no-images.json');
    const nodes = findImageNodes(body, 'openai-chat');
    expect(nodes.length).toBe(0);
  });
});
