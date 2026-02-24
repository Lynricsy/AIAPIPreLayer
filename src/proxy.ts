import type { AppConfig, ProcessorContext, RouteTarget } from './types/index.ts';
import { detectApiFormat, extractTarget } from './routing.ts';
import { PayloadTooLargeError, RoutingError } from './utils/errors.ts';
import { createLogger } from './utils/logger.ts';

const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH']);

function parseMaxPayloadSize(size: string): number {
  const normalized = size.trim().toLowerCase();
  const match = /^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb)?$/.exec(normalized);

  if (!match) {
    throw new Error(`Invalid maxPayloadSize: ${size}`);
  }

  const amountRaw = match[1];
  if (amountRaw === undefined) {
    throw new Error(`Invalid maxPayloadSize: ${size}`);
  }

  const amount = Number(amountRaw);
  const unit = (match[2] ?? 'b').toLowerCase();

  let multiplier = 1;
  switch (unit) {
    case 'kb':
      multiplier = 1024;
      break;
    case 'mb':
      multiplier = 1024 * 1024;
      break;
    case 'gb':
      multiplier = 1024 * 1024 * 1024;
      break;
    case 'b':
      multiplier = 1;
      break;
    default:
      throw new Error(`Invalid maxPayloadSize unit: ${size}`);
  }

  return Math.floor(amount * multiplier);
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

function jsonError(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
    },
  });
}

function toRequestPath(req: Request): string {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(req.url);
  } catch {
    throw new RoutingError(req.url, 'invalid request URL');
  }

  return `${parsedUrl.pathname}${parsedUrl.search}`;
}

export function createProxyHandler(
  pipeline: { process(ctx: ProcessorContext): Promise<ProcessorContext> },
  config: AppConfig,
): (req: Request) => Promise<Response> {
  const logger = createLogger('proxy');
  const maxPayloadBytes = parseMaxPayloadSize(config.server.maxPayloadSize);

  return async (req: Request): Promise<Response> => {
    try {
      const requestPath = toRequestPath(req);

      let target: RouteTarget;
      try {
        target = extractTarget(requestPath);
      } catch (error) {
        const reason = error instanceof Error ? error.message : 'target extraction failed';
        throw new RoutingError(requestPath, reason);
      }

      const apiFormat = detectApiFormat(target.host, target.path);
      logger.info('Forwarding request', {
        method: req.method,
        target: target.targetUrl,
        format: apiFormat,
      });

      const outgoingHeaders = new Headers(req.headers);
      outgoingHeaders.delete('host');

      let outgoingBody: string | undefined;
      const upperMethod = req.method.toUpperCase();

      if (BODY_METHODS.has(upperMethod)) {
        const contentLengthRaw = req.headers.get('content-length');
        if (contentLengthRaw !== null) {
          const declaredLength = Number.parseInt(contentLengthRaw, 10);
          if (!Number.isNaN(declaredLength) && declaredLength > maxPayloadBytes) {
            throw new PayloadTooLargeError(declaredLength, maxPayloadBytes);
          }
        }

        const rawBody = await req.text();
        const actualSize = byteLength(rawBody);
        if (actualSize > maxPayloadBytes) {
          throw new PayloadTooLargeError(actualSize, maxPayloadBytes);
        }

        let parsedBody: unknown;
        let isJson = false;

        try {
          parsedBody = JSON.parse(rawBody);
          isJson = true;
        } catch {
          parsedBody = undefined;
          isJson = false;
        }

        if (isJson) {
          const ctx: ProcessorContext = {
            requestBody: parsedBody,
            apiFormat,
            targetUrl: target.targetUrl,
            headers: Object.fromEntries(req.headers.entries()),
            config,
          };

          const processed = await pipeline.process(ctx);
          outgoingBody = JSON.stringify(processed.requestBody);
        } else {
          outgoingBody = rawBody;
        }

        outgoingHeaders.set('content-length', String(byteLength(outgoingBody)));
      }

      const upstreamResponse = await fetch(
        new Request(target.targetUrl, {
          method: req.method,
          headers: outgoingHeaders,
          body: outgoingBody,
          signal: req.signal,
        }),
      );

      const contentType = upstreamResponse.headers.get('content-type') ?? '';
      if (contentType.includes('text/event-stream')) {
        logger.debug('SSE response passthrough', { target: target.targetUrl });
      }

      return new Response(upstreamResponse.body, {
        status: upstreamResponse.status,
        statusText: upstreamResponse.statusText,
        headers: upstreamResponse.headers,
      });
    } catch (error) {
      if (error instanceof RoutingError) {
        return jsonError(400, error.message);
      }

      if (error instanceof PayloadTooLargeError) {
        return jsonError(413, error.message);
      }

      logger.error('Proxy request failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return jsonError(502, 'Bad Gateway');
    }
  };
}
