/**
 * SSE (Server-Sent Events) 解析工具
 *
 * 提供 SSE 流格式的解析、序列化功能，以及用于检测
 * 快速模型预处理失败（加密推理无法解密场景）的辅助函数。
 *
 * 参考规范：https://html.spec.whatwg.org/multipage/server-sent-events.html
 */

// =====================
// 类型定义
// =====================

/** 解析后的 SSE 事件 */
export interface SSEEvent {
  /** 事件类型（对应 `event:` 字段） */
  event?: string;
  /** 事件数据（对应 `data:` 字段，多行以 `\n` 连接） */
  data: string;
  /** 事件 ID（对应 `id:` 字段） */
  id?: string;
  /** 重连时间（对应 `retry:` 字段，单位毫秒） */
  retry?: number;
}

// =====================
// 核心解析函数
// =====================

/**
 * 将一段完整的 SSE 文本块解析为事件数组。
 *
 * 适用于一次性处理已完整接收的文本段（非流式场景）。
 * 事件之间以空行（`\n\n`）分隔；字段名与值之间以冒号分隔。
 * 以 `:` 开头的行为注释，忽略处理。
 *
 * @param chunk 包含一个或多个 SSE 事件的原始文本
 * @returns 解析出的 SSEEvent 数组（可能为空）
 */
export function parseSSEChunk(chunk: string): SSEEvent[] {
  const events: SSEEvent[] = [];
  // 按空行切分多个事件块
  const blocks = chunk.split(/\n\n/);

  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;

    const event = parseSSEBlock(trimmed);
    // 只有包含 data 字段的块才算有效事件
    if (event !== null) {
      events.push(event);
    }
  }

  return events;
}

/**
 * 解析单个 SSE 事件块（即两个空行之间的内容）。
 * 内部工具函数，不对外导出。
 */
function parseSSEBlock(block: string): SSEEvent | null {
  const lines = block.split('\n');
  let eventType: string | undefined;
  const dataLines: string[] = [];
  let id: string | undefined;
  let retry: number | undefined;

  for (const line of lines) {
    // 注释行，跳过
    if (line.startsWith(':')) continue;

    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) {
      // 没有冒号：字段名即为整行，值为空字符串（规范行为）
      const fieldName = line;
      if (fieldName === 'data') dataLines.push('');
      continue;
    }

    const fieldName = line.slice(0, colonIdx);
    // 冒号后有可选的一个空格
    const rawValue = line.slice(colonIdx + 1);
    const value = rawValue.startsWith(' ') ? rawValue.slice(1) : rawValue;

    switch (fieldName) {
      case 'event':
        eventType = value;
        break;
      case 'data':
        dataLines.push(value);
        break;
      case 'id':
        id = value;
        break;
      case 'retry': {
        const num = parseInt(value, 10);
        if (!isNaN(num)) retry = num;
        break;
      }
      // 未知字段忽略
    }
  }

  // 没有 data 行则不构成有效事件（规范：缺少 data 字段时丢弃）
  if (dataLines.length === 0) return null;

  const result: SSEEvent = {
    data: dataLines.join('\n'),
  };
  if (eventType !== undefined) result.event = eventType;
  if (id !== undefined) result.id = id;
  if (retry !== undefined) result.retry = retry;

  return result;
}

// =====================
// 流式解析器
// =====================

/**
 * 创建一个有状态的 SSE 流式行解析器。
 *
 * 适用于流式接收场景——上游 chunk 可能在行中间或事件中间切断。
 * 解析器内部维护行缓冲与当前事件字段缓冲，保证跨 chunk 正确拼接。
 *
 * 用法：
 * ```ts
 * const parser = createSSELineParser();
 * for await (const chunk of stream) {
 *   const events = parser.push(chunk);
 *   // 处理 events
 * }
 * const remaining = parser.flush();
 * ```
 *
 * @returns 包含 `push` 和 `flush` 方法的解析器对象
 */
export function createSSELineParser(): {
  push(chunk: string): SSEEvent[];
  flush(): SSEEvent[];
} {
  // 未处理完的行尾缓冲（跨 chunk 的不完整行）
  let lineBuffer = '';
  // 当前事件的字段缓冲
  let currentEventType: string | undefined;
  let currentDataLines: string[] = [];
  let currentId: string | undefined;
  let currentRetry: number | undefined;

  /** 将已积累的字段组装成事件，然后重置字段缓冲 */
  function flushCurrentEvent(): SSEEvent | null {
    if (currentDataLines.length === 0) {
      // 重置但不产生事件
      currentEventType = undefined;
      currentDataLines = [];
      currentId = undefined;
      currentRetry = undefined;
      return null;
    }
    const event: SSEEvent = { data: currentDataLines.join('\n') };
    if (currentEventType !== undefined) event.event = currentEventType;
    if (currentId !== undefined) event.id = currentId;
    if (currentRetry !== undefined) event.retry = currentRetry;

    // 重置字段缓冲
    currentEventType = undefined;
    currentDataLines = [];
    currentId = undefined;
    currentRetry = undefined;

    return event;
  }

  /** 处理单行文本 */
  function processLine(line: string, events: SSEEvent[]): void {
    // 空行 → 事件分隔符，尝试派发当前事件
    if (line === '') {
      const event = flushCurrentEvent();
      if (event) events.push(event);
      return;
    }

    // 注释行
    if (line.startsWith(':')) return;

    const colonIdx = line.indexOf(':');
    let fieldName: string;
    let value: string;

    if (colonIdx === -1) {
      fieldName = line;
      value = '';
    } else {
      fieldName = line.slice(0, colonIdx);
      const rawValue = line.slice(colonIdx + 1);
      value = rawValue.startsWith(' ') ? rawValue.slice(1) : rawValue;
    }

    switch (fieldName) {
      case 'event':
        currentEventType = value;
        break;
      case 'data':
        currentDataLines.push(value);
        break;
      case 'id':
        currentId = value;
        break;
      case 'retry': {
        const num = parseInt(value, 10);
        if (!isNaN(num)) currentRetry = num;
        break;
      }
    }
  }

  return {
    /**
     * 推入新的原始文本 chunk，返回本次产生的完整事件列表。
     */
    push(chunk: string): SSEEvent[] {
      const events: SSEEvent[] = [];
      const text = lineBuffer + chunk;
      const lines = text.split('\n');

      // 最后一个元素可能是不完整的行，暂存到缓冲
      lineBuffer = lines.pop() ?? '';

      for (const line of lines) {
        processLine(line, events);
      }

      return events;
    },

    /**
     * 清空内部缓冲，返回剩余的未完成事件（如果有效）。
     * 通常在流结束时调用。
     */
    flush(): SSEEvent[] {
      const events: SSEEvent[] = [];

      // 处理最后一个可能没有换行的行
      if (lineBuffer !== '') {
        processLine(lineBuffer, events);
        lineBuffer = '';
      }

      // 尝试派发当前缓冲中的事件
      const event = flushCurrentEvent();
      if (event) events.push(event);

      return events;
    },
  };
}

// =====================
// 事件判断工具
// =====================

/** 表示有输出内容的事件类型前缀 */
const OUTPUT_EVENT_PREFIXES = [
  'response.output_item',
  'response.content_part',
  'response.function_call_arguments',
] as const;

/**
 * 判断给定的 SSE 事件是否属于"有输出内容"的事件类型。
 *
 * 只要 `event` 字段以下列前缀之一开头即认为有输出：
 * - `response.output_item`
 * - `response.content_part`
 * - `response.function_call_arguments`
 *
 * @param event 待检测的 SSE 事件
 * @returns 是输出事件则返回 `true`
 */
export function isOutputEvent(event: SSEEvent): boolean {
  if (!event.event) return false;
  return OUTPUT_EVENT_PREFIXES.some((prefix) => event.event!.startsWith(prefix));
}

/**
 * 判断给定的事件序列是否符合"快速模型预处理失败"模式。
 *
 * 该模式特征：
 * 1. 存在 `response.created` 事件
 * 2. 存在 `response.in_progress` 事件
 * 3. 存在 `error` 事件
 * 4. 存在 `response.failed` 事件
 * 5. **不存在** 任何输出事件（无实际内容生成）
 * 6. 整个响应在 10 秒内结束（`elapsedMs < 10000`）
 *
 * 此模式通常对应加密推理内容无法被当前模型解密，导致
 * 预处理阶段直接报错的场景，可作为触发重试的判断依据。
 *
 * @param events    收集到的全部 SSE 事件
 * @param elapsedMs 从发起请求到收到所有事件的耗时（毫秒）
 * @returns 符合快速预处理失败模式则返回 `true`
 */
export function isFastModelPreprocessFailure(
  events: SSEEvent[],
  elapsedMs: number,
): boolean {
  const hasResponseCreated = events.some((e) => e.event === 'response.created');
  const hasResponseInProgress = events.some((e) => e.event === 'response.in_progress');
  const hasError = events.some((e) => e.event === 'error');
  const hasResponseFailed = events.some((e) => e.event === 'response.failed');
  const hasOutputEvents = events.some((e) => isOutputEvent(e));

  return (
    hasResponseCreated &&
    hasResponseInProgress &&
    hasError &&
    hasResponseFailed &&
    !hasOutputEvents &&
    elapsedMs < 10000
  );
}

// =====================
// 序列化工具
// =====================

/**
 * 将 SSEEvent 对象序列化回标准 SSE 文本格式。
 *
 * 输出格式示例（含 event 字段）：
 * ```
 * event: response.created\ndata: {...}\n\n
 * ```
 *
 * 若 `data` 包含换行，每行都会以独立的 `data:` 前缀输出：
 * ```
 * data: line1\ndata: line2\n\n
 * ```
 *
 * @param event 要序列化的 SSE 事件
 * @returns 符合 SSE 规范的文本字符串（以 `\n\n` 结尾）
 */
export function serializeSSEEvent(event: SSEEvent): string {
  const lines: string[] = [];

  if (event.event !== undefined) {
    lines.push(`event: ${event.event}`);
  }

  if (event.id !== undefined) {
    lines.push(`id: ${event.id}`);
  }

  if (event.retry !== undefined) {
    lines.push(`retry: ${event.retry}`);
  }

  // data 字段支持多行
  const dataLines = event.data.split('\n');
  for (const dataLine of dataLines) {
    lines.push(`data: ${dataLine}`);
  }

  return lines.join('\n') + '\n\n';
}
