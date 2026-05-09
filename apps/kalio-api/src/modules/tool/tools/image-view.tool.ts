import { Injectable, Logger } from '@nestjs/common';
import type { ToolCallRequest } from '@kalio/types';
import { Tool } from '../../../common/decorators/tool.decorator';
import { VFSService } from '../../vfs/vfs.service';

const MIME_MAP: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
};

function getPathArg(args: ToolCallRequest['args']): string {
  const rawValue = args['path'];
  if (typeof rawValue !== 'string' || rawValue.trim().length === 0) {
    throw new Error('INVALID_PATH: path must be a non-empty string');
  }
  return rawValue.trim();
}

function getQualityArg(args: ToolCallRequest['args']): 'low' | 'medium' | 'high' {
  const rawValue = args['quality'];
  if (rawValue === undefined) {
    return 'low';
  }
  if (rawValue !== 'low' && rawValue !== 'medium' && rawValue !== 'high') {
    throw new Error('INVALID_QUALITY: quality must be one of "low", "medium", or "high"');
  }
  return rawValue;
}

function getMimeType(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase();
  if (!ext || !(ext in MIME_MAP)) {
    throw new Error(`File is not an image: ${filePath}`);
  }
  return MIME_MAP[ext];
}

@Injectable()
@Tool({
  name: 'image_view',
  description: `View or inspect an image from the session VFS.
Returns the image as a base64 data URL that vision-capable LLMs can analyze.
Use this to review generated images, check quality, or analyze image content before further processing.`,
  parameters: {
    type: 'object',
    required: ['path'],
    properties: {
      path:    { type: 'string', description: 'File path in session VFS (e.g. "images/dragon.png")' },
      quality: { type: 'string', description: 'Detail level for vision: "low", "medium", "high". Default: low' },
    },
  },
  requiresConfirmation: false,
})
export class ImageViewTool {
  private readonly logger = new Logger(ImageViewTool.name);

  constructor(private readonly vfs: VFSService) {}

  async execute(request: ToolCallRequest): Promise<object> {
    const start = Date.now();
    const { sessionId } = request;
    const vfsSessionId = request.vfsSessionId ?? sessionId;
    const filePath = getPathArg(request.args);
    const quality = getQualityArg(request.args);
    const mimeType = getMimeType(filePath);

    let buffer: Buffer;
    try {
      buffer = this.vfs.readBinary(vfsSessionId, filePath);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'VFS_FILE_NOT_FOUND' || code === 'ENOENT') {
        throw new Error(`Image not found: ${filePath}`);
      }
      throw err;
    }

    const dataUrl = `data:${mimeType};base64,${buffer.toString('base64')}`;

    this.logger.debug(`[image_view] Loaded ${filePath} (${buffer.length} bytes) for VFS session ${vfsSessionId}`);

    return {
      image_url: dataUrl,
      path: filePath,
      quality,
      size: buffer.length,
      message: `Image loaded from ${filePath}. Vision LLM can now analyze this image.`,
      output_type: 'image',
    };
  }
}
