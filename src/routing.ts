import type { ApiFormat, RouteTarget } from './types/index.ts';

/**
 * Extracts target URL from the proxy request path.
 * Example: "/api.openai.com/v1/chat/completions" → RouteTarget
 * First path segment = host, remainder = path, protocol always HTTPS.
 * @throws {Error} if host is empty or invalid (no dots in hostname)
 */
export function extractTarget(requestPath: string): RouteTarget {
  const stripped = requestPath.startsWith('/') ? requestPath.slice(1) : requestPath;

  if (!stripped) {
    throw new Error(`Invalid request path: "${requestPath}" — host cannot be empty`);
  }

  const slashIdx = stripped.indexOf('/');
  const host = slashIdx === -1 ? stripped : stripped.slice(0, slashIdx);
  const path = slashIdx === -1 ? '/' : stripped.slice(slashIdx);

  if (!host || !host.includes('.')) {
    throw new Error(`Invalid host in request path: "${host}" — hostname must contain at least one dot`);
  }

  const protocol = 'https';
  const targetUrl = `${protocol}://${host}${path}`;

  return { targetUrl, protocol, host, path };
}

/**
 * Detects which AI API format a request targets based on host + path.
 * Host comparison is case-insensitive.
 */
export function detectApiFormat(host: string, path: string): ApiFormat {
  const lowerHost = host.toLowerCase();

  if (lowerHost === 'api.openai.com') {
    if (path.startsWith('/v1/chat/completions')) return 'openai-chat';
    if (path.startsWith('/v1/responses')) return 'openai-responses';
  }

  if (lowerHost === 'api.anthropic.com' && path.startsWith('/v1/messages')) {
    return 'anthropic';
  }

  if (lowerHost === 'generativelanguage.googleapis.com' && path.includes('generateContent')) {
    return 'gemini';
  }

  // 兜底路径匹配：兼容带子路径的中继服务（如 right.codes/codex/v1/responses）
  if (path.includes('/v1/responses')) return 'openai-responses';
  if (path.includes('/v1/chat/completions')) return 'openai-chat';
  if (path.includes('/v1/messages')) return 'anthropic';
  if (path.includes('generateContent')) return 'gemini';

  return 'unknown';
}
