import sharp from 'sharp';
import { decodeBase64, encodeBase64 } from '../../utils/base64.js';
import { ProcessorError } from '../../utils/errors.js';
import { WEBP_MIME } from '../../utils/mime.js';

export interface ImageConvertOptions {
  quality?: number;
  effort?: number;
  maxWidth?: number;
  maxHeight?: number;
}

function toPositiveDimension(value: number | undefined): number | undefined {
  if (value === undefined || value <= 0) {
    return undefined;
  }
  return value;
}

function toError(value: unknown): Error {
  if (value instanceof Error) {
    return value;
  }
  return new Error(String(value));
}

export async function convertToWebP(buffer: Buffer, options: ImageConvertOptions = {}): Promise<Buffer> {
  try {
    const width = toPositiveDimension(options.maxWidth);
    const height = toPositiveDimension(options.maxHeight);
    let pipeline = sharp(buffer);

    if (width !== undefined || height !== undefined) {
      pipeline = pipeline.resize({
        width,
        height,
        fit: 'inside',
        withoutEnlargement: true,
      });
    }

    return await pipeline
      .webp({
        quality: options.quality ?? 80,
        effort: options.effort ?? 4,
      })
      .toBuffer();
  } catch (error: unknown) {
    const wrapped = new Error('Failed to convert image to WebP', { cause: toError(error) });
    throw new ProcessorError('imageConverter', wrapped);
  }
}

export async function convertBase64ToWebP(
  base64: string,
  options: ImageConvertOptions = {}
): Promise<{ base64: string; mimeType: string }> {
  const decoded = decodeBase64(base64);
  const converted = await convertToWebP(decoded, options);

  return {
    base64: encodeBase64(converted),
    mimeType: WEBP_MIME,
  };
}
