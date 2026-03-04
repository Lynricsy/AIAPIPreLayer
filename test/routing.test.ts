import { describe, expect, test } from 'bun:test';
import { extractTarget, detectApiFormat } from '../src/routing.ts';

describe('extractTarget', () => {
  test('OpenAI chat completions path', () => {
    const result = extractTarget('/api.openai.com/v1/chat/completions');
    expect(result).toEqual({
      targetUrl: 'https://api.openai.com/v1/chat/completions',
      protocol: 'https',
      host: 'api.openai.com',
      path: '/v1/chat/completions',
    });
  });

  test('Anthropic messages path', () => {
    const result = extractTarget('/api.anthropic.com/v1/messages');
    expect(result).toEqual({
      targetUrl: 'https://api.anthropic.com/v1/messages',
      protocol: 'https',
      host: 'api.anthropic.com',
      path: '/v1/messages',
    });
  });

  test('Gemini generateContent path with dynamic model name', () => {
    const result = extractTarget(
      '/generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent',
    );
    expect(result).toEqual({
      targetUrl:
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent',
      protocol: 'https',
      host: 'generativelanguage.googleapis.com',
      path: '/v1beta/models/gemini-pro:generateContent',
    });
  });

  test('throws on empty path string', () => {
    expect(() => extractTarget('')).toThrow();
  });

  test('throws on path with only a slash', () => {
    expect(() => extractTarget('/')).toThrow();
  });

  test('throws on host with no dots', () => {
    expect(() => extractTarget('/localhost/some/path')).toThrow();
  });

  test('preserves query parameters in path', () => {
    const result = extractTarget('/api.openai.com/v1/chat/completions?stream=true&n=1');
    expect(result.path).toBe('/v1/chat/completions?stream=true&n=1');
    expect(result.targetUrl).toBe(
      'https://api.openai.com/v1/chat/completions?stream=true&n=1',
    );
    expect(result.host).toBe('api.openai.com');
    expect(result.protocol).toBe('https');
  });

  test('host-only path (no trailing slash) defaults path to /', () => {
    const result = extractTarget('/api.openai.com');
    expect(result.host).toBe('api.openai.com');
    expect(result.path).toBe('/');
    expect(result.targetUrl).toBe('https://api.openai.com/');
  });
});

describe('detectApiFormat', () => {
  test('openai-chat for /v1/chat/completions', () => {
    expect(detectApiFormat('api.openai.com', '/v1/chat/completions')).toBe('openai-chat');
  });

  test('openai-responses for /v1/responses', () => {
    expect(detectApiFormat('api.openai.com', '/v1/responses')).toBe('openai-responses');
  });

  test('anthropic for /v1/messages', () => {
    expect(detectApiFormat('api.anthropic.com', '/v1/messages')).toBe('anthropic');
  });

  test('gemini for googleapis.com + generateContent in path', () => {
    expect(
      detectApiFormat(
        'generativelanguage.googleapis.com',
        '/v1beta/models/gemini-pro:generateContent',
      ),
    ).toBe('gemini');
  });

  test('unknown for unrecognized host+path', () => {
    expect(detectApiFormat('unknown.host.com', '/some/path')).toBe('unknown');
  });

  test('host comparison is case-insensitive', () => {
    expect(detectApiFormat('API.OPENAI.COM', '/v1/chat/completions')).toBe('openai-chat');
    expect(detectApiFormat('Api.Anthropic.Com', '/v1/messages')).toBe('anthropic');
  });

  test('openai-chat with query parameters', () => {
    expect(detectApiFormat('api.openai.com', '/v1/chat/completions?stream=true')).toBe(
      'openai-chat',
    );
  });
});

describe('detectApiFormat - relay host path detection', () => {
  test('unknown host with /v1/responses returns openai-responses', () => {
    expect(detectApiFormat('relay.example.com', '/v1/responses')).toBe('openai-responses');
  });

  test('unknown host with /v1/chat/completions returns openai-chat', () => {
    expect(detectApiFormat('relay.example.com', '/v1/chat/completions')).toBe('openai-chat');
  });

  test('codehub.ling.plus with /v1/responses returns openai-responses', () => {
    expect(detectApiFormat('codehub.ling.plus', '/v1/responses')).toBe('openai-responses');
  });

  test('unknown host with /v1/other returns unknown', () => {
    expect(detectApiFormat('relay.example.com', '/v1/other')).toBe('unknown');
  });

  test('known hosts still use host-specific rules', () => {
    expect(detectApiFormat('api.openai.com', '/v1/responses')).toBe('openai-responses');
  });
});
