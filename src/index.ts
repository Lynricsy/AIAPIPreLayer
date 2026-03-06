import { Hono } from 'hono';
import { loadConfig } from './config.ts';
import { createProxyHandler } from './proxy.ts';
import { createProcessorRegistry } from './registry.ts';
import { createLogger, initLogger } from './utils/logger.ts';

const config = loadConfig();
initLogger(config.logging);
const pipeline = createProcessorRegistry(config);
const proxyHandler = createProxyHandler(pipeline, config);

const app = new Hono();

app.get('/health', (c) =>
  c.json({
    status: 'ok',
  }),
);

app.all('/*', (c) => proxyHandler(c.req.raw));

const logger = createLogger('server');

if (import.meta.main) {
  logger.info('Server started', {
    host: config.server.host,
    port: config.server.port,
  });
}

export { app, config };

export default {
  port: config.server.port,
  hostname: config.server.host,
  idleTimeout: 120,
  fetch: app.fetch,
};
