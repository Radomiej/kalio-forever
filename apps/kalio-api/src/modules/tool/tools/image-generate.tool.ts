import { Injectable, Logger } from '@nestjs/common';
import type { ToolCallRequest } from '@kalio/types';
import { Tool } from '../../../common/decorators/tool.decorator';
import { ImageGenerationService } from '../../image/image-generation.service';
import { ImageConfigService } from '../../image/image-config.service';
import { VFSService } from '../../vfs/vfs.service';

const SUPPORTED_IMAGE_PROVIDERS = ['cometapi', 'openai', 'openrouter', 'replicate'];

@Injectable()
@Tool({
  name: 'image_generate',
  description: `Generate an image using AI (CometAPI, OpenAI, or OpenRouter-compatible).
The image is saved to the session VFS under the images/ folder and returned inline.

Supported models: flux-schnell (default, fast/cheap), flux-pro, gpt-image-1, dall-e-3, kling-image.
Quality: low (fast/cheap), medium, high (slow/expensive).

Use edit_image instead when the user provides existing reference images from the VFS for character/style consistency.`,
  parameters: {
    type: 'object',
    required: ['prompt'],
    properties: {
      prompt:        { type: 'string',  description: 'Detailed description of the image to generate' },
      model:         { type: 'string',  description: 'Image model name (e.g. "flux-schnell", "gpt-image-1", "dall-e-3"). Default: flux-schnell' },
      size:          { type: 'string',  description: 'Image size (e.g. "1024x1024", "1024x1536", "512x512"). Default: 1024x1024' },
      quality:       { type: 'string',  description: 'Quality level: "low" (fast), "medium", "high" (slow). Default: low' },
      output_format: { type: 'string',  description: 'Output format: "png", "jpeg", "webp". Default: png' },
      filename:      { type: 'string',  description: 'Optional filename (e.g. "dragon.png"). Auto-generated if omitted.' },
    },
  },
  requiresConfirmation: false,
})
export class ImageGenerateTool {
  private readonly logger = new Logger(ImageGenerateTool.name);

  constructor(
    private readonly imageGen: ImageGenerationService,
    private readonly imageConfig: ImageConfigService,
    private readonly vfs: VFSService,
  ) {}

  async execute(request: ToolCallRequest): Promise<object> {
    const start = Date.now();
    const { sessionId } = request;

    const prompt = request.args['prompt'] as string;
    const model = (request.args['model'] as string | undefined) ?? 'flux-schnell';
    const size = (request.args['size'] as string | undefined) ?? '1024x1024';
    const quality = (request.args['quality'] as 'low' | 'medium' | 'high' | undefined) ?? 'low';
    const output_format = (request.args['output_format'] as 'png' | 'jpeg' | 'webp' | undefined) ?? 'png';

    const cfg = await this.imageConfig.getConfig();
    const apiKey = await this.imageConfig.getApiKey();

    if (!apiKey) {
      return {
        error: 'No API key configured for image generation. Go to Settings → Image Generation to add a key.',
      };
    }

    let provider = cfg.provider === 'auto' ? 'cometapi' : cfg.provider;
    if (!SUPPORTED_IMAGE_PROVIDERS.includes(provider)) {
      this.logger.warn(`[image_generate] Provider ${provider} doesn't support image generation, falling back to cometapi`);
      provider = 'cometapi';
    }

    try {
      const result = await this.imageGen.generate({
        prompt,
        model,
        size,
        quality,
        output_format,
        provider,
        apiKey,
        baseUrl: cfg.baseUrl,
      });

      const ext = result.format || 'png';
      const rawFilename = (request.args['filename'] as string | undefined) ?? `image-${Date.now()}.${ext}`;
      const vfsPath = rawFilename.startsWith('images/') ? rawFilename : `images/${rawFilename}`;

      this.vfs.writeBinary(sessionId, vfsPath, result.buffer);

      this.logger.log(`[image_generate] Saved ${vfsPath} (${result.buffer.length} bytes) for session ${sessionId}`);

      return {
        image_url: result.dataUrl,
        path: vfsPath,
        model: result.model,
        size: result.size,
        format: result.format,
        download_url: `/api/session-vfs/${sessionId}/download?path=${encodeURIComponent(vfsPath)}`,
        message: `Image generated and saved to ${vfsPath}.`,
        output_type: 'image',
      };
    } catch (err) {
      this.logger.error('[image_generate] Failed', err instanceof Error ? err : new Error(String(err)));
      return { error: err instanceof Error ? err.message : String(err) };
    }
  }
}
