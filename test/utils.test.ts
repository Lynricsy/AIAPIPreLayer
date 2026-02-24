import { test, expect, describe } from 'bun:test';
import {
  decodeBase64,
  encodeBase64,
  parseDataUri,
  buildDataUri,
  detectMimeType,
  isBase64Image,
} from '../src/utils/base64';
import { isSupportedImageMime, updateMimeType, WEBP_MIME } from '../src/utils/mime';

const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const PNG_DATA_URI = `data:image/png;base64,${PNG_BASE64}`;

describe('parseDataUri', () => {
  test('correctly parses a valid PNG data URI', () => {
    const result = parseDataUri(PNG_DATA_URI);
    expect(result).not.toBeNull();
    expect(result?.mimeType).toBe('image/png');
    expect(result?.base64Data).toBe(PNG_BASE64);
  });

  test('returns null for invalid input', () => {
    expect(parseDataUri('not-a-data-uri')).toBeNull();
    expect(parseDataUri('')).toBeNull();
    expect(parseDataUri('data:image/png')).toBeNull();
  });
});

describe('buildDataUri', () => {
  test('produces a valid data URI string', () => {
    const uri = buildDataUri('image/png', PNG_BASE64);
    expect(uri).toBe(PNG_DATA_URI);
    expect(uri.startsWith('data:image/png;base64,')).toBe(true);
  });

  test('roundtrip: parseDataUri(buildDataUri(mime, data)) returns same values', () => {
    const mime = 'image/jpeg';
    const data = 'abc123xyz';
    const uri = buildDataUri(mime, data);
    const parsed = parseDataUri(uri);
    expect(parsed).not.toBeNull();
    expect(parsed?.mimeType).toBe(mime);
    expect(parsed?.base64Data).toBe(data);
  });
});

describe('decodeBase64 / encodeBase64', () => {
  test('roundtrip: encodeBase64(decodeBase64(s)) returns original string', () => {
    const decoded = decodeBase64(PNG_BASE64);
    expect(decoded).toBeInstanceOf(Buffer);
    const reencoded = encodeBase64(decoded);
    expect(reencoded).toBe(PNG_BASE64);
  });
});

describe('detectMimeType', () => {
  test('correctly identifies PNG magic bytes from real base64', () => {
    const mime = detectMimeType(PNG_BASE64);
    expect(mime).toBe('image/png');
  });

  test('returns null for non-image base64', () => {
    const plainText = Buffer.from('Hello, world!').toString('base64');
    expect(detectMimeType(plainText)).toBeNull();
  });
});

describe('isBase64Image', () => {
  test('returns true for data URIs', () => {
    expect(isBase64Image(PNG_DATA_URI)).toBe(true);
    expect(isBase64Image('data:image/jpeg;base64,abc')).toBe(true);
  });

  test('returns true for raw base64 PNG', () => {
    expect(isBase64Image(PNG_BASE64)).toBe(true);
  });

  test('returns false for plain text', () => {
    const plainText = Buffer.from('Hello, world!').toString('base64');
    expect(isBase64Image(plainText)).toBe(false);
    expect(isBase64Image('just plain text')).toBe(false);
  });
});

describe('isSupportedImageMime', () => {
  test('correctly validates supported MIME types', () => {
    expect(isSupportedImageMime('image/png')).toBe(true);
    expect(isSupportedImageMime('image/jpeg')).toBe(true);
    expect(isSupportedImageMime('image/gif')).toBe(true);
    expect(isSupportedImageMime('image/webp')).toBe(true);
    expect(isSupportedImageMime('image/bmp')).toBe(false);
    expect(isSupportedImageMime('text/plain')).toBe(false);
  });
});

describe('updateMimeType', () => {
  test('always returns image/webp', () => {
    expect(updateMimeType('image/png')).toBe(WEBP_MIME);
    expect(updateMimeType('image/jpeg')).toBe('image/webp');
    expect(updateMimeType('anything')).toBe('image/webp');
  });
});
