/** 支持的 WebP MIME 类型常量 */
export const WEBP_MIME = 'image/webp' as const;

/** 支持的输入图片 MIME 类型列表 */
export const SUPPORTED_IMAGE_MIMES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const;

export type SupportedImageMime = typeof SUPPORTED_IMAGE_MIMES[number];

/** 检查 MIME 类型是否为支持的图片格式 */
export function isSupportedImageMime(mime: string): mime is SupportedImageMime {
  return (SUPPORTED_IMAGE_MIMES as readonly string[]).includes(mime);
}

/** 将 MIME 类型更新为 WebP（转换后使用） */
export function updateMimeType(_originalMime: string): typeof WEBP_MIME {
  return WEBP_MIME;
}
