import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { convertBase64ToWebP, convertToWebP } from '../src/processors/image/converter';
import { decodeBase64 } from '../src/utils/base64';
import { ProcessorError } from '../src/utils/errors';
import { WEBP_MIME } from '../src/utils/mime';

const FIXTURE_PATH = join(import.meta.dir, 'fixtures', 'openai-chat.json');

function expectValidWebP(buffer: Buffer): void {
  expect(buffer.subarray(0, 4).toString('ascii')).toBe('RIFF');
  expect(buffer.subarray(8, 12).toString('ascii')).toBe('WEBP');
}

function getFixturePngBase64(): string {
  const fixture = readFileSync(FIXTURE_PATH, 'utf-8');
  const match = fixture.match(/data:image\/png;base64,([A-Za-z0-9+/=]+)/);

  if (!match || !match[1]) {
    throw new Error('PNG base64 not found in test fixture');
  }

  return match[1];
}

async function createPatternPng(width: number, height: number): Promise<Buffer> {
  const pixelData = Buffer.alloc(width * height * 3);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 3;
      pixelData[offset] = x % 256;
      pixelData[offset + 1] = y % 256;
      pixelData[offset + 2] = (x * y) % 256;
    }
  }

  return sharp(pixelData, {
    raw: {
      width,
      height,
      channels: 3,
    },
  })
    .png()
    .toBuffer();
}

describe('convertToWebP', () => {
  test('converts PNG buffer to valid WebP buffer', async () => {
    const png = decodeBase64(getFixturePngBase64());
    const webp = await convertToWebP(png);

    expectValidWebP(webp);
  });

  test('quality option affects output size', async () => {
    const png = await createPatternPng(256, 256);
    const lowQuality = await convertToWebP(png, { quality: 20, effort: 4 });
    const highQuality = await convertToWebP(png, { quality: 90, effort: 4 });

    expect(lowQuality.length).toBeLessThan(highQuality.length);
  });

  test('applies resize constraints with inside fit and no enlargement', async () => {
    const png = await createPatternPng(120, 80);
    const webp = await convertToWebP(png, { maxWidth: 60, maxHeight: 40 });
    const metadata = await sharp(webp).metadata();

    expect(metadata.width).toBeDefined();
    expect(metadata.height).toBeDefined();
    expect(metadata.width!).toBeLessThanOrEqual(60);
    expect(metadata.height!).toBeLessThanOrEqual(40);
  });

  test('throws ProcessorError for corrupted image input', async () => {
    try {
      await convertToWebP(Buffer.from('not-a-valid-image'));
      throw new Error('expected convertToWebP to throw');
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(ProcessorError);
      if (error instanceof Error) {
        expect(error.message).toContain('Failed to convert image to WebP');
      }
    }
  });
});

describe('convertBase64ToWebP', () => {
  test('converts fixture PNG base64 to WebP base64 and updates mime type', async () => {
    const sourceBase64 = getFixturePngBase64();
    const result = await convertBase64ToWebP(sourceBase64);

    expect(result.mimeType).toBe(WEBP_MIME);
    expectValidWebP(decodeBase64(result.base64));
  });
});
