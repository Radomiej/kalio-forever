import { Injectable, Logger } from '@nestjs/common';
import sharp from 'sharp';
import type { ChatAttachment, LLMImagePart } from '@kalio/types';
import { VFSService } from '../vfs/vfs.service';

const MAX_LONG_SIDE = 1568;            // px — Anthropic guidance, also safe for OpenAI/Gemini
const RESIZE_THRESHOLD_BYTES = 1 << 20; // 1 MB — re-encode anything larger
const HARD_CEILING_BYTES = 5 << 20;     // 5 MB — final base64 cap; reject if exceeded
const JPEG_QUALITY = 85;

const IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

export class ImageHydrationError extends Error {
  constructor(public readonly code: 'PAYLOAD_TOO_LARGE' | 'UNSUPPORTED_MIME', message: string) {
    super(message);
    this.name = 'ImageHydrationError';
  }
}

/**
 * Reads attachments from the per-session VFS, optionally downscales large
 * images, and produces OpenAI-compatible multimodal `image_url` parts.
 *
 * Wire-level output shape:
 *   { type: 'image_url', image_url: { url: 'data:<mime>;base64,...' } }
 *
 * The hydrator never goes outside `VFSService` for filesystem access, so the
 * same path-traversal sandbox protects image reads.
 */
@Injectable()
export class ImageHydratorService {
  private readonly logger = new Logger(ImageHydratorService.name);

  constructor(private readonly vfs: VFSService) {}

  async hydrate(sessionId: string, attachments: ChatAttachment[]): Promise<LLMImagePart[]> {
    const parts: LLMImagePart[] = [];
    for (const att of attachments) {
      if (!IMAGE_MIME_TYPES.has(att.mimeType)) {
        throw new ImageHydrationError('UNSUPPORTED_MIME', `Unsupported attachment mime type: ${att.mimeType}`);
      }
      const part = await this.hydrateOne(sessionId, att);
      parts.push(part);
    }
    return parts;
  }

  private async hydrateOne(sessionId: string, att: ChatAttachment): Promise<LLMImagePart> {
    const raw = this.vfs.readBinary(sessionId, att.path);

    let outBuffer: Buffer = raw;
    let outMime: string = att.mimeType;

    const needsResize = raw.length > RESIZE_THRESHOLD_BYTES || (await this.exceedsDimensions(raw));
    if (needsResize) {
      outBuffer = await sharp(raw)
        .rotate() // honour EXIF orientation
        .resize({
          width: MAX_LONG_SIDE,
          height: MAX_LONG_SIDE,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .jpeg({ quality: JPEG_QUALITY })
        .toBuffer();
      outMime = 'image/jpeg';
      this.logger.debug(
        `Hydrated ${att.path}: ${raw.length} → ${outBuffer.length} bytes (resized + jpeg q${JPEG_QUALITY})`,
      );
    }

    const base64 = outBuffer.toString('base64');
    // Quick rough estimate: base64 ~= 4/3 * bytes — but check the actual length.
    if (base64.length > HARD_CEILING_BYTES) {
      throw new ImageHydrationError(
        'PAYLOAD_TOO_LARGE',
        `Image ${att.path} exceeds ${HARD_CEILING_BYTES} bytes after resize (${base64.length} bytes base64)`,
      );
    }
    return {
      type: 'image_url',
      image_url: { url: `data:${outMime};base64,${base64}` },
    };
  }

  private async exceedsDimensions(buffer: Buffer): Promise<boolean> {
    try {
      const meta = await sharp(buffer).metadata();
      const w = meta.width ?? 0;
      const h = meta.height ?? 0;
      return Math.max(w, h) > MAX_LONG_SIDE;
    } catch {
      return false;
    }
  }
}
