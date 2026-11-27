import { Inject, Injectable } from '@nestjs/common';
import { IMAGE_PROVIDER_CAPABILITIES, NATIVE_IMAGE_GENERATOR, type ImageEditor, type ImageEditRequest, type NativeImageGenerator, type NativeImageResult } from '@kalio/types';
import sharp from 'sharp';
import { fetchAndConvertImage } from './image-utils';

@Injectable()
export class ImageEditingService implements ImageEditor {
  constructor(@Inject(NATIVE_IMAGE_GENERATOR) private readonly native: NativeImageGenerator) {}

  async edit(req: ImageEditRequest): Promise<NativeImageResult> {
    const capability = IMAGE_PROVIDER_CAPABILITIES[req.config.provider];
    if (!capability?.edit) throw new Error(`Image editing is not supported by ${req.config.provider}. Choose an editing provider in Settings → Image Generation.`);
    if (req.references.length > capability.maxReferences) throw new Error(`Too many references: ${req.references.length}. Maximum is ${capability.maxReferences}.`);
    if (capability.editTransport === 'native') {
      if (!req.config.executionProfileId) throw new Error('Select a ChatGPT / Codex integration in Settings → Image Generation.');
      return this.native.generate({
        executionProfileId: req.config.executionProfileId, prompt: req.prompt,
        size: `${req.aspectRatio}, ${req.imageSize}`, quality: 'high', outputFormat: 'png', abortSignal: req.abortSignal,
        references: req.references.map(item => ({ dataUrl: `data:${item.mimeType};base64,${item.base64}`, label: item.ref.label, role: item.ref.role })),
      });
    }
    if (!req.apiKey) throw new Error('No API key configured for image editing. Go to Settings → Image Generation to add a key.');
    return capability.editTransport === 'openai' ? this.openai(req) : this.gemini(req);
  }

  private async openai(req: ImageEditRequest): Promise<NativeImageResult> {
    const model = req.model || req.config.editModel || 'gpt-image-1';
    if (!/^gpt-image-/.test(model) && model !== 'dall-e-2') throw new Error(`Model ${model} does not support OpenAI image editing.`);
    if (!req.references.length) throw new Error('Image editing requires at least one reference image.');
    if (model === 'dall-e-2' && req.references.length !== 1) throw new Error('dall-e-2 editing accepts exactly one reference image.');
    const form = new FormData();
    form.set('model', model); form.set('prompt', `${req.prompt}\nRequested aspect ratio: ${req.aspectRatio}; resolution: ${req.imageSize}.`);
    if (model !== 'dall-e-2') {
      const [width, height] = req.aspectRatio.split(':').map(Number);
      form.set('size', width > height ? '1536x1024' : height > width ? '1024x1536' : '1024x1024');
    }
    if (model === 'dall-e-2') form.set('response_format', 'b64_json');
    else form.set('output_format', 'png');
    for (const [index, item] of req.references.entries()) {
      const bytes = Uint8Array.from(Buffer.from(item.base64, 'base64'));
      form.append(model === 'dall-e-2' ? 'image' : 'image[]', new Blob([bytes], { type: item.mimeType }), `reference-${index}.${item.mimeType.split('/')[1]}`);
    }
    const response = await fetch(`${(req.config.baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '')}/images/edits`, {
      method: 'POST', headers: { Authorization: `Bearer ${req.apiKey}` }, body: form,
      signal: req.abortSignal ? AbortSignal.any([req.abortSignal, AbortSignal.timeout(180_000)]) : AbortSignal.timeout(180_000),
    });
    const data = await this.readResponse(response) as { data?: Array<{ b64_json?: string; url?: string }> };
    const item = data.data?.[0];
    const source = item?.b64_json ? `data:image/png;base64,${item.b64_json}` : item?.url;
    if (!source) throw new Error('OpenAI returned no edited image data.');
    const result = await fetchAndConvertImage(source);
    return this.toResult(result.buffer, model);
  }

  private async gemini(req: ImageEditRequest): Promise<NativeImageResult> {
    const aliases: Record<string, string> = { flash: 'gemini-3.1-flash-image-preview', pro: 'gemini-3-pro-image-preview' };
    const selected = req.model || req.config.editModel || 'flash';
    const model = aliases[selected] || selected;
    if (!model.startsWith('gemini-')) throw new Error(`Model ${model} does not support Gemini image editing.`);
    // TODO: legacy fallback — auto/CometAPI settings without a URL use the historical endpoint.
    const baseUrl = (req.config.baseUrl || 'https://api.cometapi.com').replace(/\/$/, '').replace(/\/v\d+$/, '');
    const response = await fetch(`${baseUrl}/v1beta/models/${model}:generateContent`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': req.apiKey! },
      signal: req.abortSignal ? AbortSignal.any([req.abortSignal, AbortSignal.timeout(180_000)]) : AbortSignal.timeout(180_000),
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: req.prompt }, ...req.references.map(item => ({ inline_data: { mime_type: item.mimeType, data: item.base64 } }))] }],
        generationConfig: { responseModalities: ['TEXT', 'IMAGE'], imageConfig: { aspectRatio: req.aspectRatio, imageSize: req.imageSize }, thinkingConfig: { thinkingLevel: req.thinkingLevel, includeThoughts: false } },
      }),
    });
    const data = await this.readResponse(response) as { candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { mimeType: string; data: string } }> } }> };
    const image = data.candidates?.[0]?.content?.parts?.find(part => part.inlineData?.data)?.inlineData;
    if (!image) throw new Error('Gemini returned no image data. Try adjusting your prompt or references.');
    return this.toResult(Buffer.from(image.data, 'base64'), model);
  }

  private async readResponse(response: Response): Promise<unknown> {
    if (!response.ok) {
      if (response.status === 429) throw new Error('Image generation rate limit reached. Please wait a moment and try again.');
      const body = await response.text();
      throw new Error(`Image editing failed (HTTP ${response.status}): ${body.slice(0, 200)}`);
    }
    return response.json();
  }

  private async toResult(bytes: Buffer, model: string): Promise<NativeImageResult> {
    const { data, info } = await sharp(bytes, { limitInputPixels: 40_000_000 }).png().toBuffer({ resolveWithObject: true });
    return { bytes: data, mimeType: 'image/png', format: 'png', model, width: info.width, height: info.height };
  }
}
