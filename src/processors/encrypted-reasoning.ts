/**
 * encrypted-reasoning.ts
 *
 * 用于检测和处理 OpenAI Responses API 请求体中加密推理内容的纯函数集合。
 *
 * 背景：当请求体的 input 数组中包含 type=reasoning 的条目，且含有
 * encrypted_content 字段时，可能触发模型前置处理阶段的快速失败（model_error）。
 * 通过删除末尾或全部的 encrypted_content，可有效规避此问题。
 *
 * encrypted_content 有两种格式：
 *   1. 顶层格式：{ type: "reasoning", encrypted_content: "...", summary: "..." }
 *   2. 嵌套格式：{ type: "reasoning", content: [{ type: "reasoning_encrypted", encrypted_content: "..." }] }
 * 两种格式均需处理。
 */

// =====================
// 内部工具
// =====================

function isObject(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null && !Array.isArray(val);
}

function isArray(val: unknown): val is unknown[] {
  return Array.isArray(val);
}

/** 检查单个 reasoning item 是否含有 encrypted_content（顶层或嵌套格式） */
function itemHasEncryptedContent(item: Record<string, unknown>): boolean {
  if (typeof item['encrypted_content'] === 'string' && item['encrypted_content']) return true;

  const content = item['content'];
  if (!isArray(content)) return false;
  return content.some(
    (sub) => isObject(sub) && typeof sub['encrypted_content'] === 'string' && sub['encrypted_content'],
  );
}

/** 删除单个 reasoning item 的 encrypted_content（顶层 + 嵌套均处理） */
function deleteItemEncryptedContent(item: Record<string, unknown>): boolean {
  let deleted = false;

  if (typeof item['encrypted_content'] === 'string') {
    delete item['encrypted_content'];
    deleted = true;
  }

  const content = item['content'];
  if (isArray(content)) {
    for (const sub of content) {
      if (isObject(sub) && typeof sub['encrypted_content'] === 'string') {
        delete (sub as Record<string, unknown>)['encrypted_content'];
        deleted = true;
      }
    }
  }

  return deleted;
}

// =====================
// 导出函数
// =====================

/**
 * 检测请求体中是否存在加密推理内容。
 *
 * 遍历 body.input 数组，判断是否存在 type==="reasoning" 的条目，
 * 且该条目的 content 子数组中有任意一项具有非空 encrypted_content 字段。
 *
 * @param body - 请求体（unknown 类型，函数内部做安全校验）
 * @returns 存在加密推理内容时返回 true，否则返回 false
 */
export function hasEncryptedReasoningContent(body: unknown): boolean {
  if (!isObject(body)) return false;

  const input = body['input'];
  if (!isArray(input)) return false;

  for (const item of input) {
    if (!isObject(item)) continue;
    if (item['type'] !== 'reasoning') continue;
    if (itemHasEncryptedContent(item)) return true;
  }

  return false;
}

/**
 * 删除最后一个 reasoning 条目中的所有 encrypted_content 字段。
 *
 * 策略：找到 input 数组中最后一个 type==="reasoning" 的条目，
 * 对其 content 子数组中每个含有 encrypted_content（字符串类型）的子项执行删除。
 * 操作对原始 body 无副作用（使用 structuredClone 深拷贝）。
 *
 * @param body - 请求体（unknown 类型）
 * @returns `{ body: 修改后的请求体, changed: 是否发生了变更 }`
 *   若无可删除内容则返回原始 body 引用（changed: false）
 */
export function dropLastReasoningEncryptedContent(
  body: unknown,
): { body: unknown; changed: boolean } {
  if (!isObject(body)) return { body, changed: false };

  const input = body['input'];
  if (!isArray(input)) return { body, changed: false };

  let lastReasoningIndex = -1;
  for (let i = input.length - 1; i >= 0; i--) {
    const item = input[i];
    if (isObject(item) && item['type'] === 'reasoning') {
      lastReasoningIndex = i;
      break;
    }
  }

  if (lastReasoningIndex === -1) return { body, changed: false };

  const lastReasoning = input[lastReasoningIndex];
  if (!isObject(lastReasoning)) return { body, changed: false };
  if (!itemHasEncryptedContent(lastReasoning)) return { body, changed: false };

  const clone = structuredClone(body) as Record<string, unknown>;
  const cloneInput = clone['input'] as unknown[];
  const cloneReasoning = cloneInput[lastReasoningIndex] as Record<string, unknown>;
  deleteItemEncryptedContent(cloneReasoning);

  return { body: clone, changed: true };
}

/**
 * 删除所有 reasoning 条目中的 encrypted_content 字段。
 *
 * 策略：遍历 input 数组中所有 type==="reasoning" 的条目，
 * 对每个条目的 content 子数组中含有 encrypted_content（字符串类型）的子项执行删除。
 * 操作对原始 body 无副作用（使用 structuredClone 深拷贝）。
 *
 * @param body - 请求体（unknown 类型）
 * @returns `{ body: 修改后的请求体, changed: 是否发生了变更 }`
 *   若无可删除内容则返回原始 body 引用（changed: false）
 */
export function dropAllReasoningEncryptedContent(
  body: unknown,
): { body: unknown; changed: boolean } {
  if (!isObject(body)) return { body, changed: false };

  const input = body['input'];
  if (!isArray(input)) return { body, changed: false };

  let hasAny = false;
  for (const item of input) {
    if (!isObject(item) || item['type'] !== 'reasoning') continue;
    if (itemHasEncryptedContent(item)) {
      hasAny = true;
      break;
    }
  }

  if (!hasAny) return { body, changed: false };

  const clone = structuredClone(body) as Record<string, unknown>;
  const cloneInput = clone['input'] as unknown[];

  for (const item of cloneInput) {
    if (!isObject(item) || item['type'] !== 'reasoning') continue;
    deleteItemEncryptedContent(item as Record<string, unknown>);
  }

  return { body: clone, changed: true };
}
