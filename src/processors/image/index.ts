import type { ImageConvertOptions } from './converter.js';
import { convertBase64ToWebP } from './converter.js';
import { findImageNodes, replaceImageNode } from './traversal.js';
import type { ImageProcessorConfig, PreProcessor, ProcessorContext } from '../../types/index.js';
import { createLogger } from '../../utils/logger.js';

export type ImageConfig = ImageProcessorConfig;

const logger = createLogger('imageProcessor');

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

export class ImageProcessor implements PreProcessor {
  public readonly name = 'imageProcessor';

  constructor(private readonly config: ImageConfig) {}

  enabled(): boolean {
    return this.config.enabled;
  }

  async process(context: ProcessorContext): Promise<ProcessorContext> {
    if (context.apiFormat === undefined || context.apiFormat === null || context.apiFormat === 'unknown') {
      logger.debug('Skip image processing: api format missing or unsupported', {
        apiFormat: context.apiFormat ?? null,
      });
      return context;
    }

    const nodes = findImageNodes(context.requestBody, context.apiFormat);
    if (nodes.length === 0) {
      logger.debug('Skip image processing: no image nodes found', {
        apiFormat: context.apiFormat,
      });
      return context;
    }

    const options: ImageConvertOptions = {
      quality: this.config.output.quality,
      effort: this.config.output.effort,
      maxWidth: this.config.resize.maxWidth,
      maxHeight: this.config.resize.maxHeight,
    };

    let processedCount = 0;
    let convertedOriginalBytes = 0;
    let convertedNewBytes = 0;

    for (const node of nodes) {
      try {
        const converted = await convertBase64ToWebP(node.base64, options);
        replaceImageNode(context.requestBody, node, converted.base64, converted.mimeType);

        processedCount += 1;
        convertedOriginalBytes += Buffer.byteLength(node.base64, 'base64');
        convertedNewBytes += Buffer.byteLength(converted.base64, 'base64');
      } catch (error: unknown) {
        logger.warn('Failed to convert image, keeping original', {
          path: node.path,
          format: node.format,
          error: getErrorMessage(error),
        });
      }
    }

    const savedBytesRaw = convertedOriginalBytes - convertedNewBytes;
    const savedBytes = savedBytesRaw > 0 ? savedBytesRaw : 0;
    const reduction =
      convertedOriginalBytes === 0 ? 0 : (savedBytes / convertedOriginalBytes) * 100;

    logger.info(
      `Processed ${processedCount}/${nodes.length} images, saved ${savedBytes} bytes (${reduction.toFixed(2)}% reduction)`,
      {
        processedCount,
        totalCount: nodes.length,
        savedBytes,
        reductionPercent: Number(reduction.toFixed(2)),
      },
    );

    return context;
  }
}
