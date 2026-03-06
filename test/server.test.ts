import { describe, expect, test } from 'bun:test';
import { DEFAULT_CONFIG } from '../src/config.ts';
import { app, config } from '../src/index.ts';

describe('server entrypoint', () => {
  test('app is defined and exposes fetch method', () => {
    expect(app).toBeDefined();
    expect(typeof app.fetch).toBe('function');
  });

  test('config is loaded with expected defaults', () => {
    expect(config.server.port).toBe(DEFAULT_CONFIG.server.port);
    expect(config.server.host).toBe(DEFAULT_CONFIG.server.host);
    expect(config.server.maxPayloadSize).toBe(DEFAULT_CONFIG.server.maxPayloadSize);
    expect(config.logging.level).toBe(DEFAULT_CONFIG.logging.level);
    expect(config.logging.format).toBe(DEFAULT_CONFIG.logging.format);
  });

  test('simple GET request returns a response without crashing', async () => {
    const response = await app.fetch(new Request('http://localhost/invalid-host/v1/messages'));

    expect(response).toBeInstanceOf(Response);
    expect(response.status).toBe(400);
  });

  test('health endpoint returns ok without entering proxy routing', async () => {
    const response = await app.fetch(new Request('http://localhost/health'));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
  });
});
