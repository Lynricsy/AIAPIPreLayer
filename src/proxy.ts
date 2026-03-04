import type { AppConfig, ProcessorContext, RouteTarget } from './types/index.ts';
import type { SSEEvent } from './utils/sse.ts';
import { detectApiFormat, extractTarget } from './routing.ts';
import { PayloadTooLargeError, RoutingError } from './utils/errors.ts';
import { createLogger } from './utils/logger.ts';
import {
  hasEncryptedReasoningContent,
  dropLastReasoningEncryptedContent,
  dropAllReasoningEncryptedContent,
} from './processors/encrypted-reasoning.ts';
import {
  createSSELineParser,
  isOutputEvent,
  isFastModelPreprocessFailure,
  serializeSSEEvent,
} from './utils/sse.ts';

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

/**
 * 判断是否需要对该请求进行 SSE 拦截与重试
 * 条件：openai-responses 格式 + 启用 encryptedReasoning + 请求体包含 encrypted_content
 */
function shouldInterceptResponse(
  apiFormat: string,
  parsedBody: unknown | undefined,
  config: AppConfig,
): boolean {
  if (apiFormat !== 'openai-responses') return false;
  if (!config.processors.encryptedReasoning.enabled) return false;
  if (!parsedBody) return false;
  return hasEncryptedReasoningContent(parsedBody);
}

/**
 * SSE 前导事件缓冲结果
 */
type SSEReadResult = { done: boolean; value?: Uint8Array };

type PreambleResult =
  | { type: 'success'; bufferedChunks: Uint8Array[]; reader: ReadableStreamDefaultReader<Uint8Array>; done: boolean; pendingRead: Promise<SSEReadResult> | null }
  | { type: 'failure'; events: SSEEvent[] };

/**
 * 缓冲 SSE 前导事件，检测快速失败模式
 * - 缓冲 preamble 事件直到看到输出事件或超时
 * - 如果流在出现输出事件之前结束且符合快速失败模式，返回 failure
 * - 否则返回 success，附带已缓冲的原始数据块和 reader
 */
async function bufferPreamble(
  response: Response,
  startTime: number,
  preambleTimeoutMs: number,
): Promise<PreambleResult> {
  const reader = response.body!.getReader() as ReadableStreamDefaultReader<Uint8Array>;
  const decoder = new TextDecoder();
  const parser = createSSELineParser();
  const allEvents: SSEEvent[] = [];
  const bufferedChunks: Uint8Array[] = [];
  let streamDone = false;

  let pendingReadPromise: Promise<SSEReadResult> | null = null;

  while (!streamDone) {
    const elapsed = Date.now() - startTime;
    if (elapsed >= preambleTimeoutMs) {
      // 超时 — 当作成功处理，flush 缓冲
      break;
    }

    const remaining = preambleTimeoutMs - elapsed;

    const readPromise = reader.read();

    const raceResult = await Promise.race([
      readPromise.then((r) => ({ kind: 'read' as const, result: r })),
      new Promise<{ kind: 'timeout' }>((resolve) =>
        setTimeout(() => resolve({ kind: 'timeout' }), remaining),
      ),
    ]);

    if (raceResult.kind === 'timeout') {
      pendingReadPromise = readPromise;
      break;
    }

    const { done, value } = raceResult.result;
    if (done) {
      streamDone = true;
      const tail = decoder.decode();
      if (tail) {
        allEvents.push(...parser.push(tail));
      }
      allEvents.push(...parser.flush());
      break;
    }

    bufferedChunks.push(value!);
    const text = decoder.decode(value!, { stream: true });
    const events = parser.push(text);
    allEvents.push(...events);

    // 一旦看到输出事件，说明模型已经开始生成，不是快速失败
    if (events.some((e) => isOutputEvent(e))) {
      break;
    }
  }

  // 流已结束且没有看到输出事件 — 检查是否是快速失败
  if (streamDone) {
    const elapsed = Date.now() - startTime;
    if (isFastModelPreprocessFailure(allEvents, elapsed)) {
      reader.releaseLock();
      return { type: 'failure', events: allEvents };
    }
  }

  // 成功路径：返回缓冲的 chunks + reader 供后续 pipe
  return {
    type: 'success',
    bufferedChunks,
    reader,
    done: streamDone,
    pendingRead: pendingReadPromise,
  };
}

/**
 * 从缓冲的事件重建 SSE 响应（用于将失败透传给客户端）
 */
function reconstructFailureResponse(
  events: SSEEvent[],
  upstreamResponse: Response,
): Response {
  const encoder = new TextEncoder();
  const serialized = events.map((e) => serializeSSEEvent(e)).join('');
  const body = encoder.encode(serialized);

  const headers = new Headers(upstreamResponse.headers);
  headers.set('content-length', String(body.byteLength));

  return new Response(body, {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers,
  });
}

/**
 * 构造带有流拼接的 SSE 响应
 * 先输出已缓冲的原始数据块，再 pipe 剩余的上游数据
 */
function createStitchedResponse(
  preamble: Extract<PreambleResult, { type: 'success' }>,
  upstreamResponse: Response,
): Response {
  let prefixIndex = 0;
  let firstRead: Promise<SSEReadResult> | null = preamble.pendingRead;

  const responseStream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (prefixIndex < preamble.bufferedChunks.length) {
        controller.enqueue(preamble.bufferedChunks[prefixIndex]!);
        prefixIndex++;
        return;
      }

      if (preamble.done) {
        try {
          preamble.reader.releaseLock();
        } catch {}
        controller.close();
        return;
      }

      let result: SSEReadResult;
      try {
        if (firstRead) {
          result = await firstRead;
          firstRead = null;
        } else {
          result = await preamble.reader.read();
        }
      } catch (e) {
        controller.error(e);
        return;
      }

      if (result.done) {
        try {
          preamble.reader.releaseLock();
        } catch {}
        controller.close();
        return;
      }

      controller.enqueue(result.value!);
    },
    async cancel(reason) {
      try {
        await preamble.reader.cancel(reason);
      } catch {}
      try {
        preamble.reader.releaseLock();
      } catch {}
    },
  });

  return new Response(responseStream, {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers: upstreamResponse.headers,
  });
}

/**
 * 处理包含 encrypted_content 的 Responses API 请求
 * 实现两级重试：先去掉最后一个 encrypted_content，再去掉所有
 *
 * @param targetUrl 上游目标 URL
 * @param method HTTP 方法
 * @param headers 请求头（将被 clone 并修改 content-length）
 * @param originalBody 原始解析后的请求体
 * @param config 应用配置
 * @param logger 日志器
 * @param signal 中止信号
 */
async function handleResponsesWithRetry(
  targetUrl: string,
  method: string,
  headers: Headers,
  originalBody: unknown,
  config: AppConfig,
  logger: ReturnType<typeof createLogger>,
  signal?: AbortSignal | null,
): Promise<Response> {
  const { maxRetries, preambleTimeoutMs } = config.processors.encryptedReasoning;
  let currentBody = originalBody;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const startTime = Date.now();
    const bodyStr = JSON.stringify(currentBody);

    // 克隆 headers 并更新 content-length
    const reqHeaders = new Headers(headers);
    reqHeaders.set('content-length', String(byteLength(bodyStr)));

    const fetchInit: RequestInit = {
      method,
      headers: reqHeaders,
      body: bodyStr,
    };
    if (signal) {
      fetchInit.signal = signal;
    }

    const upstreamResponse = await fetch(new Request(targetUrl, fetchInit));

    // 非 SSE 响应直接透传（不重试）
    const contentType = upstreamResponse.headers.get('content-type') ?? '';
    if (!contentType.includes('text/event-stream') || !upstreamResponse.body) {
      return new Response(upstreamResponse.body, {
        status: upstreamResponse.status,
        statusText: upstreamResponse.statusText,
        headers: upstreamResponse.headers,
      });
    }

    // SSE 响应 — 选择性缓冲前导事件
    logger.debug('Intercepting SSE response for encrypted reasoning retry', {
      attempt: attempt + 1,
      target: targetUrl,
    });

    const preambleResult = await bufferPreamble(upstreamResponse, startTime, preambleTimeoutMs);

    if (preambleResult.type === 'success') {
      return createStitchedResponse(preambleResult, upstreamResponse);
    }

    // 快速失败模式 — 决定是否重试
    if (attempt >= maxRetries) {
      // 重试耗尽，将失败透传给客户端
      logger.warn('Encrypted reasoning retry exhausted, passing failure to client', {
        attempt: attempt + 1,
        maxRetries,
      });
      return reconstructFailureResponse(preambleResult.events, upstreamResponse);
    }

    logger.warn('Encrypted reasoning fast failure detected, retrying', {
      attempt: attempt + 1,
      maxRetries,
    });

    if (attempt === 0) {
      const droppedLast = dropLastReasoningEncryptedContent(currentBody);
      if (droppedLast.changed) {
        currentBody = droppedLast.body;
      } else {
        const droppedAll = dropAllReasoningEncryptedContent(currentBody);
        if (droppedAll.changed) {
          currentBody = droppedAll.body;
        }
      }
    } else {
      const droppedAll = dropAllReasoningEncryptedContent(originalBody);
      if (droppedAll.changed) {
        currentBody = droppedAll.body;
      }
    }
  }

  // 不应到达此处，安全兜底
  throw new Error('Encrypted reasoning retry logic exhausted unexpectedly');
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
      let parsedBody: unknown = undefined;
      let isJson = false;
      let processedRequestBody: unknown | undefined = undefined;
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
          processedRequestBody = processed.requestBody;
          outgoingBody = JSON.stringify(processedRequestBody);
        } else {
          outgoingBody = rawBody;
        }

        outgoingHeaders.set('content-length', String(byteLength(outgoingBody)));
      }

      if (
        isJson &&
        processedRequestBody !== undefined &&
        shouldInterceptResponse(apiFormat, parsedBody, config)
      ) {
        return await handleResponsesWithRetry(
          target.targetUrl,
          req.method,
          outgoingHeaders,
          processedRequestBody,
          config,
          logger,
          req.signal,
        );
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
        logger.warn('Routing error', { error: error.message });
        return jsonError(400, error.message);
      }

      if (error instanceof PayloadTooLargeError) {
        logger.warn('Payload too large', { error: error.message });
        return jsonError(413, error.message);
      }

      if (error instanceof DOMException && error.name === 'AbortError') {
        logger.info('Client disconnected', { error: error.message });
        return new Response(null, { status: 499, statusText: 'Client Closed Request' });
      }

      logger.error('Proxy request failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return jsonError(502, 'Bad Gateway');
    }
  };
}
