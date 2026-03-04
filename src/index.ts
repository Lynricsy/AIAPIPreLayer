import { Hono } from 'hono';
import { loadConfig } from './config.ts';
import { createProxyHandler } from './proxy.ts';
import { createProcessorRegistry } from './registry.ts';
import { createLogger } from './utils/logger.ts';

const config = loadConfig();
const pipeline = createProcessorRegistry(config);
const proxyHandler = createProxyHandler(pipeline, config);

const app = new Hono();

app.all('/*', (c) => proxyHandler(c.req.raw));

const logger = createLogger('server', config.logging.level);

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
