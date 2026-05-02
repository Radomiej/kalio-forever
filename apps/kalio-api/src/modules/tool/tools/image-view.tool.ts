import { Injectable, Logger } from '@nestjs/common';
import type { ToolCallRequest } from '@kalio/types';
import { Tool } from '../../../common/decorators/tool.decorator';
import { VFSService } from '../../vfs/vfs.service';

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
    const filePath = request.args['path'] as string;
    const quality = (request.args['quality'] as string | undefined) ?? 'low';

    let buffer: Buffer;
    try {
      buffer = this.vfs.readBinary(sessionId, filePath);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'VFS_FILE_NOT_FOUND' || code === 'ENOENT') {
        return { error: `Image not found: ${filePath}` };
      }
      throw err;
    }

    const ext = filePath.split('.').pop()?.toLowerCase() ?? 'png';
    const mimeMap: Record<string, string> = {
      jpg: 'image/jpeg', jpeg: 'image/jpeg',
      png: 'image/png', webp: 'image/webp', gif: 'image/gif',
    };
    const mimeType = mimeMap[ext] ?? 'image/png';

    if (!mimeType.startsWith('image/')) {
      return { error: `File is not an image: ${filePath}` };
    }

    const dataUrl = `data:${mimeType};base64,${buffer.toString('base64')}`;

    this.logger.debug(`[image_view] Loaded ${filePath} (${buffer.length} bytes) for session ${sessionId}`);

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
