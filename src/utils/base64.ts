/**
 * Base64 编码/解码工具函数
 * 用于处理图片数据的 Base64 编解码、Data URI 解析/构建，以及图片格式检测
 */

/** 将 base64 字符串解码为 Buffer */
export function decodeBase64(base64String: string): Buffer {
  return Buffer.from(base64String, 'base64');
}

/** 将 Buffer 编码为 base64 字符串 */
export function encodeBase64(buffer: Buffer): string {
  return buffer.toString('base64');
}

/** 解析 Data URI（例如 "data:image/png;base64,iVBOR..."）为各组件 */
export function parseDataUri(dataUri: string): { mimeType: string; base64Data: string } | null {
  const match = dataUri.match(/^data:([^;]+);base64,(.+)$/s);
  if (!match) return null;
  const mimeType = match[1];
  const base64Data = match[2];
  if (!mimeType || !base64Data) return null;
  return { mimeType, base64Data };
}

/** 从各组件构建 Data URI */
export function buildDataUri(mimeType: string, base64Data: string): string {
  return `data:${mimeType};base64,${base64Data}`;
}

/**
 * 通过检查魔术字节，从原始 base64 数据检测图片 MIME 类型
 *
 * 支持格式：
 * - PNG:  89 50 4E 47
 * - JPEG: FF D8 FF
 * - WebP: 52 49 46 46 (RIFF 头)
 * - GIF:  47 49 46 38
 */
export function detectMimeType(base64Data: string): string | null {
  // 只需要解码前几个字节即可检测魔术字节
  // 取前 12 个 base64 字符（约 9 字节）
  const prefix = base64Data.slice(0, 12);
  const bytes = Buffer.from(prefix, 'base64');

  // PNG: 89 50 4E 47
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return 'image/png';
  }

  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }

  // WebP: 52 49 46 46 (RIFF)
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) {
    return 'image/webp';
  }

  // GIF: 47 49 46 38
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) {
    return 'image/gif';
  }

  return null;
}

/**
 * 检查字符串是否像 base64 编码的图片（Data URI 或含图片魔术字节的原始 base64）
 *
 * 判断逻辑：
 * 1. 如果以 `data:image/` 开头 → 是 Data URI → 返回 true
 * 2. 否则，尝试 detectMimeType() → 非 null → 返回 true
 * 3. 其他情况 → 返回 false
 */
export function isBase64Image(value: string): boolean {
  if (value.startsWith('data:image/')) {
    return true;
  }
  return detectMimeType(value) !== null;
}
