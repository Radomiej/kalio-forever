import { Injectable, Logger } from '@nestjs/common';
import type { ToolCallRequest, ImageRef } from '@kalio/types';
import { Tool } from '../../../common/decorators/tool.decorator';
import { ImageConfigService } from '../../image/image-config.service';
import { VFSService } from '../../vfs/vfs.service';

// ── Constants ────────────────────────────────────────────────────────────────

const COMET_API_BASE = 'https://api.cometapi.com';
const SUPPORTED_IMAGE_PROVIDERS = ['cometapi', 'openai', 'openrouter'];
const MODEL_MAP: Record<string, string> = {
  flash: 'gemini-3.1-flash-image-preview',
  pro:   'gemini-3-pro-image-preview',
};
const ROLE_ORDER: ImageRef['role'][] = ['character', 'object', 'style', 'background', 'base'];
const MAX_REFS = 14;

const ROLE_HINT: Record<string, string> = {
  base:       'BASE IMAGE TO EDIT — apply only the requested changes to this specific image; preserve everything else exactly.',
  character:  "character reference — preserve this character's exact appearance and identity in the output.",
  object:     'object reference — include this exact object as shown.',
  style:      'style reference — match this visual style precisely.',
  background: 'background reference — use as the scene/environment setting.',
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function buildStructuredPrompt(refs: ImageRef[], userPrompt: string, iterationOf?: string): string {
  const isEdit = !!iterationOf || refs.some((r) => r.role === 'base');
  const sorted = [...refs].sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role));
  const lines = sorted.map(
    (ref, i) => `Image ${i + 1} [${ref.label}]: ${ROLE_HINT[ref.role] ?? 'reference image.'}`,
  );
  if (isEdit) {
    lines.push(`\nEDIT TASK: ${userPrompt}`);
    lines.push('IMPORTANT: Preserve all other aspects of the base image exactly as shown. Only modify what was explicitly requested.');
  } else {
    lines.push(`\nGenerate: ${userPrompt}`);
  }
  return lines.join('\n');
}

interface GeminiPart {
  text?: string;
  inline_data?: { mime_type: string; data: string };
}

function buildGeminiPayload(
  loadedRefs: Array<{ ref: ImageRef; base64: string; mimeType: string }>,
  structuredPrompt: string,
  aspectRatio: string,
  imageSize: string,
  thinkingLevel: string,
) {
  const parts: GeminiPart[] = [{ text: structuredPrompt }];
  const sorted = [...loadedRefs].sort((a, b) => ROLE_ORDER.indexOf(a.ref.role) - ROLE_ORDER.indexOf(b.ref.role));
  for (const item of sorted) {
    parts.push({ inline_data: { mime_type: item.mimeType, data: item.base64 } });
  }
  return {
    contents: [{ role: 'user', parts }],
    generationConfig: {
      responseModalities: ['TEXT', 'IMAGE'],
      imageConfig: { aspectRatio, imageSize },
      thinkingConfig: { thinkingLevel, includeThoughts: false },
    },
  };
}

function resolveVersionedPath(existingPaths: string[], requestedPath: string): string {
  const lastSlash = requestedPath.lastIndexOf('/');
  const dir = lastSlash >= 0 ? requestedPath.slice(0, lastSlash) : '';
  const filename = lastSlash >= 0 ? requestedPath.slice(lastSlash + 1) : requestedPath;
  const dotIdx = filename.lastIndexOf('.');
  const ext = dotIdx >= 0 ? filename.slice(dotIdx) : '.png';
  const baseName = (dotIdx >= 0 ? filename.slice(0, dotIdx) : filename).replace(/-v\d+$/, '');

  const prefix = dir ? `${dir}/${baseName}` : baseName;
  let version = 1;
  for (const path of existingPaths) {
    const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const escapedExt = ext.replace('.', '\\.');
    const match = path.match(new RegExp(`^${escapedPrefix}-v(\\d+)${escapedExt}$`));
    if (match) {
      const v = parseInt(match[1]!, 10);
      if (v >= version) version = v + 1;
    }
  }
  const versionedName = `${baseName}-v${version}${ext}`;
  return dir ? `${dir}/${versionedName}` : versionedName;
}

// ── Tool ─────────────────────────────────────────────────────────────────────

@Injectable()
@Tool({
  name: 'image_edit',
  description: `Generate or edit images using Gemini (via CometAPI) with VFS reference images.

ALWAYS use this tool (not image_generate) when the user:
- wants to EDIT an existing image (change background, style, add/remove elements)
- provides character/style references for consistent look
- wants to iterate on a previously generated image

## IMAGE EDITING
1. Set refs = [{vfsPath: <source image path>, role: "base", label: "source image"}]
2. Set iterationOf = <source image path>
3. Write prompt as edit instruction: "Change the background to a lake. Keep the character identical."

## NEW GENERATION WITH REFERENCES
- role="character" — preserve exact appearance
- role="style" — match visual style
- role="background" — use as scene/environment
- role="object" — include this specific object

Each output is auto-versioned in VFS (never overwrites existing files).`,
  parameters: {
    type: 'object',
    required: ['outputPath', 'refs', 'prompt'],
    properties: {
      outputPath:    { type: 'string', description: 'Desired VFS output path, e.g. "generated/portrait-v1.png". Auto-versioned.' },
      refs: {
        type: 'array',
        description: 'Reference images from VFS. Max 14. Each: { vfsPath: string, role: "base"|"character"|"object"|"style"|"background", label: string }.',
        items: {
          type: 'object',
          required: ['vfsPath', 'role', 'label'],
          properties: {
            vfsPath: { type: 'string' },
            role:    { type: 'string', enum: ['character', 'object', 'style', 'background', 'base'] },
            label:   { type: 'string' },
          },
        },
      },
      prompt:        { type: 'string',  description: 'Edit instruction or generation description.' },
      aspectRatio:   { type: 'string',  description: 'Aspect ratio: "1:1", "4:5", "16:9", "9:16", "3:4". Default: "1:1"' },
      imageSize:     { type: 'string',  description: 'Output resolution: "512px", "1K", "2K", "4K". Default: "1K"' },
      model:         { type: 'string',  description: 'Model: "flash" (fast/cheap) or "pro" (highest quality). Default: flash' },
      thinkingLevel: { type: 'string',  description: 'Gemini thinking effort: "minimal" or "high". Default: minimal' },
      iterationOf:   { type: 'string',  description: 'VFS path of the source image when editing. Required when role="base".' },
    },
  },
  requiresConfirmation: true,
})
export class ImageEditTool {
  private readonly logger = new Logger(ImageEditTool.name);

  constructor(
    private readonly imageConfig: ImageConfigService,
    private readonly vfs: VFSService,
  ) {}

  async execute(request: ToolCallRequest): Promise<object> {
    const start = Date.now();
    const { sessionId } = request;
    const vfsSessionId = request.vfsSessionId ?? sessionId;

    const outputPath = request.args['outputPath'] as string;
    const refs = request.args['refs'] as ImageRef[];
    const prompt = request.args['prompt'] as string;
    const aspectRatio = (request.args['aspectRatio'] as string | undefined) ?? '1:1';
    const imageSize = (request.args['imageSize'] as string | undefined) ?? '1K';
    const modelKey = (request.args['model'] as string | undefined) ?? 'flash';
    const thinkingLevel = (request.args['thinkingLevel'] as string | undefined) ?? 'minimal';
    const iterationOf = request.args['iterationOf'] as string | undefined;

    if (refs.length > MAX_REFS) {
      throw new Error(`Too many references: ${refs.length}. Maximum is ${MAX_REFS}.`);
    }

    const apiKey = await this.imageConfig.getApiKey();
    if (!apiKey) {
      throw new Error('No API key configured for image editing. Go to Settings → Image Generation to add a key.');
    }

    const cfg = await this.imageConfig.getConfig();
    const effectiveBaseUrl = cfg.baseUrl?.replace(/\/$/, '').replace(/\/v\d+$/, '');
    const needsFallback =
      cfg.provider !== 'auto' && !SUPPORTED_IMAGE_PROVIDERS.includes(cfg.provider);
    const baseUrl = needsFallback ? COMET_API_BASE : (effectiveBaseUrl ?? COMET_API_BASE);

    // Load all reference images from VFS
    const loadedRefs: Array<{ ref: ImageRef; base64: string; mimeType: string }> = [];
    for (const ref of refs) {
      let buffer: Buffer;
      try {
        buffer = this.vfs.readBinary(vfsSessionId, ref.vfsPath);
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'VFS_FILE_NOT_FOUND' || code === 'ENOENT') {
          throw new Error(`Ref not found in VFS: "${ref.vfsPath}". Upload or generate it first.`, {
            cause: err,
          });
        }
        throw err;
      }

      const ext = ref.vfsPath.split('.').pop()?.toLowerCase() ?? 'png';
      const mimeMap: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' };
      const mimeType = mimeMap[ext] ?? 'image/png';
      loadedRefs.push({ ref, base64: buffer.toString('base64'), mimeType });
    }

    // List existing VFS files for versioning
    const existingFiles = this.vfs.listFiles(vfsSessionId);
    const vfsPath = resolveVersionedPath(existingFiles.files.map((f) => f.path), outputPath);

    const structuredPrompt = buildStructuredPrompt(refs, prompt, iterationOf);
    const modelId = MODEL_MAP[modelKey] ?? MODEL_MAP['flash'];
    const geminiPayload = buildGeminiPayload(loadedRefs, structuredPrompt, aspectRatio, imageSize, thinkingLevel);

    const url = `${baseUrl}/v1beta/models/${modelId}:generateContent`;

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify(geminiPayload),
      });
    } catch (err) {
      this.logger.error('[image_edit] Network error', err instanceof Error ? err : new Error(String(err)));
      throw new Error(`Network error: ${err instanceof Error ? err.message : String(err)}`, {
        cause: err,
      });
    }

    if (!response.ok) {
      const errBody = await response.text().catch(() => 'unknown');
      if (response.status === 429) {
        throw new Error('Image generation rate limit reached. Please wait a moment and try again.');
      }
      throw new Error(`Image generation failed (HTTP ${response.status}): ${errBody.slice(0, 200)}`);
    }

    const data = await response.json() as {
      candidates?: Array<{
        content?: {
          parts?: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }>;
        };
      }>;
    };

    const parts = data.candidates?.[0]?.content?.parts ?? [];
    const imagePart = parts.find((p) => p.inlineData?.data);
    if (!imagePart?.inlineData) {
      this.logger.error('[image_edit] No image in Gemini response', { parts: parts.map((p) => Object.keys(p)) });
      throw new Error('Gemini returned no image data. Try adjusting your prompt or references.');
    }

    const imageBase64 = imagePart.inlineData.data;
    const imageMime = imagePart.inlineData.mimeType || 'image/png';
    const dataUrl = `data:${imageMime};base64,${imageBase64}`;
    const binaryBuf = Buffer.from(imageBase64, 'base64');
    try {
      this.vfs.writeBinary(vfsSessionId, vfsPath, binaryBuf);
    } catch (err) {
      this.logger.error('[image_edit] VFS write failed', err instanceof Error ? err : new Error(String(err)));
      throw new Error(`Failed to save image to VFS: ${err instanceof Error ? err.message : String(err)}`, {
        cause: err,
      });
    }

    const durationMs = Date.now() - start;
    this.logger.log(`[image_edit] Generated ${vfsPath} in ${durationMs}ms for VFS session ${vfsSessionId}`);

    return {
      image_url: dataUrl,
      path: vfsPath,
      model: modelId,
      refCount: refs.length,
      durationMs,
      download_url: `/api/sessions/${vfsSessionId}/vfs/download?path=${encodeURIComponent(vfsPath)}`,
      message: `Image generated and saved to ${vfsPath}. ${iterationOf ? `Iterated from ${iterationOf}. ` : ''}Used ${refs.length} reference(s).`,
      ...(iterationOf ? { iteratedFrom: iterationOf } : {}),
      output_type: 'image',
    };
  }
}
