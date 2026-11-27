import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { IMAGE_PROVIDER_CAPABILITIES, NATIVE_IMAGE_GENERATOR, type NativeImageGenerator, type ToolCallRequest } from '@kalio/types';
import { Tool } from '../../../common/decorators/tool.decorator';
import { ImageGenerationService } from '../../image/image-generation.service';
import { ImageConfigService } from '../../image/image-config.service';
import { VFSService } from '../../vfs/vfs.service';

@Injectable()
@Tool({
  name: 'image_generate',
  domain: 'image',
  description: `Generate an image using the provider selected in Settings → Image Generation, including ChatGPT / Codex.
The image is saved to the session VFS under the images/ folder and returned inline.

Supported models: flux-schnell (default, fast/cheap), flux-pro, gpt-image-1, dall-e-3, kling-image, mock-stock (free stock placeholder, no API key).
Quality: low (fast/cheap), medium, high (slow/expensive).

Use image_edit when the user provides existing reference images from the VFS for character/style consistency. ChatGPT uses the selected execution profile's model.`,
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
  requiresConfirmation: true,
})
export class ImageGenerateTool {
  private readonly logger = new Logger(ImageGenerateTool.name);

  constructor(
    private readonly imageGen: ImageGenerationService,
    private readonly imageConfig: ImageConfigService,
    private readonly vfs: VFSService,
    @Optional() @Inject(NATIVE_IMAGE_GENERATOR) private readonly nativeImages?: NativeImageGenerator,
  ) {}

  async execute(request: ToolCallRequest): Promise<object> {
    const { sessionId } = request;
    const vfsSessionId = request.vfsSessionId ?? sessionId;

    const prompt = request.args['prompt'] as string;
    const cfg = await this.imageConfig.getConfig();
    const model = (request.args['model'] as string | undefined) ?? cfg.model ?? 'flux-schnell';
    const size = (request.args['size'] as string | undefined) ?? '1024x1024';
    const quality = (request.args['quality'] as 'low' | 'medium' | 'high' | undefined) ?? 'low';
    const output_format = (request.args['output_format'] as 'png' | 'jpeg' | 'webp' | undefined) ?? 'png';

    const native = cfg.provider === 'chatgpt';
    const apiKey = native ? null : await this.imageConfig.getApiKey();
    const isMockStockModel = model.trim().toLowerCase().startsWith('mock-stock');

    if (!native && !apiKey && !isMockStockModel) {
      throw new Error('No API key configured for image generation. Go to Settings → Image Generation to add a key.');
    }

    // TODO: legacy fallback — persisted auto settings historically select CometAPI.
    const provider = cfg.provider === 'auto' ? 'cometapi' : cfg.provider;
    if (!IMAGE_PROVIDER_CAPABILITIES[provider]?.generate) {
      throw new Error(`Unsupported image provider: ${provider}. Select a provider in Settings → Image Generation.`);
    }

    try {
      const nativeResult = native ? await this.generateNative(cfg.executionProfileId, prompt, size, quality, output_format, request.abortSignal) : undefined;
      const result = nativeResult ? {
        buffer: Buffer.from(nativeResult.bytes),
        dataUrl: `data:${nativeResult.mimeType};base64,${Buffer.from(nativeResult.bytes).toString('base64')}`,
        model: nativeResult.model,
        size: `${nativeResult.width}x${nativeResult.height}`,
        format: nativeResult.format,
      } : await this.imageGen.generate({
        prompt,
        model,
        size,
        quality,
        output_format,
        provider,
        apiKey: apiKey ?? '',
        baseUrl: cfg.baseUrl,
      });

      const ext = result.format || 'png';
      const rawFilename = (request.args['filename'] as string | undefined) ?? `image-${Date.now()}.${ext}`;
      const vfsPath = rawFilename.startsWith('images/') ? rawFilename : `images/${rawFilename}`;

      this.vfs.writeBinary(vfsSessionId, vfsPath, result.buffer);

      this.logger.log(`[image_generate] Saved ${vfsPath} (${result.buffer.length} bytes) for VFS session ${vfsSessionId}`);

      // When running inside an isolated sub-agent, also compute the parent-session URL so the
      // child LLM can include it directly in its answer. This avoids the child reporting a
      // child-session URL that is unreachable from the parent after copy-back.
      const agentRun = request.agentRun;
      const parentDownloadUrl =
        agentRun?.vfsMode === 'isolated' && agentRun.parentSessionId && agentRun.vfsSessionId
          ? `/api/sessions/${agentRun.parentSessionId}/vfs/download?path=${encodeURIComponent(`sub-agents/${agentRun.vfsSessionId}/${vfsPath}`)}`
          : undefined;

      return {
        image_url: result.dataUrl,
        path: vfsPath,
        model: result.model,
        size: result.size,
        format: result.format,
        download_url: `/api/sessions/${vfsSessionId}/vfs/download?path=${encodeURIComponent(vfsPath)}`,
        ...(parentDownloadUrl ? { parent_download_url: parentDownloadUrl } : {}),
        message: parentDownloadUrl
          ? `Image generated and saved to ${vfsPath}. Use parent_download_url for embedding in the final page.`
          : `Image generated and saved to ${vfsPath}.`,
        output_type: 'image',
      };
    } catch (err) {
      this.logger.error('[image_generate] Failed', err instanceof Error ? err : new Error(String(err)));
      throw (err instanceof Error ? err : new Error(String(err)));
    }
  }

  private generateNative(executionProfileId: string | undefined, prompt: string, size: string, quality: 'low' | 'medium' | 'high', outputFormat: 'png' | 'jpeg' | 'webp', abortSignal?: AbortSignal) {
    if (!executionProfileId) throw new Error('Select a ChatGPT / Codex integration in Settings → Image Generation.');
    if (!this.nativeImages) throw new Error('Native ChatGPT image generation is unavailable.');
    return this.nativeImages.generate({ executionProfileId, prompt, size, quality, outputFormat, abortSignal });
  }
}
