/** ImageGenerationService for OpenAI-compatible image providers plus FLUX/Kling/Doubao/Qwen routing. */
import { Injectable, Logger } from '@nestjs/common';
import { fetchAndConvertImage } from './image-utils';

export type ImageModelFamily = 'openai-standard' | 'flux' | 'kling' | 'doubao' | 'qwen';

export interface ImageGenerationRequest {
  prompt: string;
  model?: string;
  size?: string;
  quality?: 'low' | 'medium' | 'high';
  output_format?: 'png' | 'jpeg' | 'webp';
  provider?: string;
  apiKey: string;
  baseUrl?: string;
}

export interface ImageGenerationResult {
  buffer: Buffer;
  mimeType: string;
  dataUrl: string;
  model: string;
  size: string;
  format: string;
}

interface ImageModelConfig {
  family: ImageModelFamily;
  endpoint: string;
  headers: Record<string, string>;
  requiresPolling: boolean;
  pollingEndpoint?: string;
}

interface OpenAIImageResponse {
  data?: Array<{ b64_json?: string; url?: string }>;
}

interface DoubaoQwenImageResponse {
  data?: Array<{ b64_json?: string; url?: string }>;
  image?: string;
}

interface PollingInitResponse {
  polling_url?: string;
  urls?: { get?: string };
  url?: string;
  data?: { polling_url?: string; task_id?: string };
}

interface ImageApiError {
  error?: { message?: string };
  message?: string;
}

const PROVIDER_BASE_URLS: Record<string, string> = {
  cometapi:   'https://api.cometapi.com/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  openai:     'https://api.openai.com/v1',
  replicate:  'https://api.replicate.com/v1',
};

/** True when talking directly to api.replicate.com (not a proxy). */
function isNativeReplicate(baseUrl: string, provider?: string): boolean {
  return provider === 'replicate' || baseUrl.toLowerCase().includes('api.replicate.com');
}

/**
 * True for providers that expose FLUX via the standard /v1/images/generations
 * endpoint without async prediction polling.
 */
function usesStandardEndpointForFlux(baseUrl: string, provider?: string): boolean {
  if (isNativeReplicate(baseUrl, provider)) return false;
  if (provider === 'openrouter' || provider === 'openai' || provider === 'cometapi') return true;
  const lower = baseUrl.toLowerCase().replace(/\/+$/, '');
  return lower.endsWith('/v1');
}

function inferProviderFromModel(modelName: string): string {
  const lower = modelName.toLowerCase();
  if (lower.includes('gpt-image') || lower.includes('dall-e')) return 'openai';
  if (lower.startsWith('openrouter/')) return 'openrouter';
  if (lower.startsWith('openai/')) return 'openai';
  return 'cometapi';
}

function resolveBaseUrl(provider?: string, baseUrl?: string, modelName?: string): string {
  if (baseUrl) return baseUrl.replace(/\/$/, '');
  const knownProvider =
    provider && Object.prototype.hasOwnProperty.call(PROVIDER_BASE_URLS, provider.toLowerCase())
      ? provider.toLowerCase()
      : undefined;
  const effectiveProvider = knownProvider ?? inferProviderFromModel(modelName ?? '');
  return PROVIDER_BASE_URLS[effectiveProvider] ?? PROVIDER_BASE_URLS['cometapi'];
}

function detectModelFamily(modelName: string): ImageModelFamily {
  const lower = modelName.toLowerCase();
  if (lower.includes('flux')) return 'flux';
  if (lower.includes('kling')) return 'kling';
  if (lower.includes('doubao') || lower.includes('seedream')) return 'doubao';
  if (lower.includes('qwen') && lower.includes('image')) return 'qwen';
  return 'openai-standard';
}

function isMockStockModel(modelName: string): boolean {
  return modelName.trim().toLowerCase().startsWith('mock-stock');
}

function parseSize(size: string): { width: number; height: number } {
  const [rawW, rawH] = size.split('x').map(Number);
  const width = Number.isFinite(rawW) && rawW > 0 ? rawW : 1024;
  const height = Number.isFinite(rawH) && rawH > 0 ? rawH : 1024;
  return { width, height };
}

function buildMockStockUrl(prompt: string, size: string): string {
  const { width, height } = parseSize(size);
  const seedBase = prompt.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').slice(0, 64);
  const seed = seedBase.length > 0 ? seedBase : 'kalio-mock-image';
  return `https://picsum.photos/seed/${encodeURIComponent(seed)}/${width}/${height}`;
}

function formatFromMimeType(mimeType: string): string {
  if (mimeType.includes('png')) return 'png';
  if (mimeType.includes('webp')) return 'webp';
  return 'jpeg';
}

interface JsonResponseLike {
  ok: boolean;
  status: number;
  statusText?: string;
  headers?: { get(name: string): string | null };
  text(): Promise<string>;
}

function getResponseContentType(response: JsonResponseLike): string {
  return response.headers?.get('content-type')?.toLowerCase() ?? '';
}

function summarizeResponseBody(rawBody: string): string {
  const compact = rawBody.replace(/\s+/g, ' ').trim();
  return compact.slice(0, 160);
}

function parseJsonBody(
  rawBody: string,
  contentType: string,
  errorPrefix: string,
): Record<string, unknown> {
  if (contentType.length > 0 && !contentType.includes('json')) {
    const snippet = summarizeResponseBody(rawBody);
    throw new Error(
      `${errorPrefix}: Expected JSON image response but received ${contentType}${snippet ? `: ${snippet}` : ''}`,
    );
  }

  try {
    return JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    const snippet = summarizeResponseBody(rawBody);
    throw new Error(
      `${errorPrefix}: Expected JSON image response but received invalid JSON${snippet ? `: ${snippet}` : ''}`,
    );
  }
}

async function readJsonResponse(response: JsonResponseLike, errorPrefix: string): Promise<Record<string, unknown>> {
  const rawBody = await response.text();
  return parseJsonBody(rawBody, getResponseContentType(response), errorPrefix);
}

async function readImageApiError(response: JsonResponseLike): Promise<ImageApiError> {
  const rawBody = await response.text().catch(() => '');
  const contentType = getResponseContentType(response);

  if (rawBody.trim().length > 0 && (contentType.length === 0 || contentType.includes('json'))) {
    try {
      return JSON.parse(rawBody) as ImageApiError;
    } catch {
      // Fall back to a readable body summary below.
    }
  }

  const snippet = summarizeResponseBody(rawBody);
  const message = snippet || response.statusText || `HTTP ${response.status}`;
  return { error: { message } };
}

function getModelConfig(
  modelName: string,
  baseUrl: string,
  apiKey: string,
  provider?: string,
): ImageModelConfig {
  const rawFamily = detectModelFamily(modelName);

  // FLUX/Kling on OpenAI-compatible /v1 endpoints → use standard /v1/images/generations.
  // Only native Replicate keeps prediction polling.
  const family: ImageModelFamily =
    (rawFamily === 'flux' || rawFamily === 'kling') && usesStandardEndpointForFlux(baseUrl, provider)
      ? 'openai-standard'
      : rawFamily;

  switch (family) {
    case 'flux': {
      const fluxModel = modelName.replace('black-forest-labs/', '');
      // Native Replicate: /v1/models/... (no extra prefix, we're already on replicate.com)
      // CometAPI and others: /replicate/v1/models/... (CometAPI proxies Replicate under this path)
      const base = baseUrl.replace(/\/v1$/, '');
      const endpoint = isNativeReplicate(baseUrl, provider)
        ? `${base}/v1/models/black-forest-labs/${fluxModel}/predictions`
        : `${base}/replicate/v1/models/black-forest-labs/${fluxModel}/predictions`;
      return {
        family,
        endpoint,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        requiresPolling: true,
      };
    }

    case 'kling': {
      // Kling native
      return {
        family,
        endpoint: `${baseUrl.replace(/\/v1$/, '')}/kling/v1/images/generations`,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'x-api-key': apiKey,
          'Content-Type': 'application/json',
        },
        requiresPolling: true,
        pollingEndpoint: `${baseUrl.replace(/\/v1$/, '')}/kling/v1/images/generations`,
      };
    }

    case 'doubao': {
      return {
        family,
        endpoint: `${baseUrl.replace(/\/v1$/, '')}/seedream/v1/images/generations`,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        requiresPolling: false,
      };
    }

    case 'qwen': {
      return {
        family,
        endpoint: `${baseUrl.replace(/\/v1$/, '')}/qwen/v1/images/generations`,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        requiresPolling: false,
      };
    }

    case 'openai-standard':
    default: {
      return {
        family: 'openai-standard',
        endpoint: `${baseUrl}/images/generations`,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        requiresPolling: false,
      };
    }
  }
}

function buildImagePayload(
  family: ImageModelFamily,
  model: string,
  prompt: string,
  size: string,
  quality: string,
  outputFormat: string,
): Record<string, unknown> {
  const [width, height] = size.split('x').map(Number);

  switch (family) {
    case 'flux': {
      // Replicate native format
      return {
        input: {
          prompt,
          width: width || 1024,
          height: height || 1024,
          seed: Math.floor(Math.random() * 1_000_000),
        },
      };
    }

    case 'kling': {
      return {
        prompt,
        model: 'kling_image',
        width: width || 1024,
        height: height || 1024,
      };
    }

    case 'doubao':
    case 'qwen': {
      return {
        model,
        prompt,
        width: width || 1024,
        height: height || 1024,
        n: 1,
      };
    }

    case 'openai-standard':
    default: {
      const isGptImage = model.toLowerCase().includes('gpt-image');
      const isFluxOrKling = /flux|kling/i.test(model);
      const payload: Record<string, unknown> = { model, prompt, n: 1, size };

      if (isGptImage) {
        payload['output_format'] = outputFormat;
        payload['quality'] = quality;
      } else if (isFluxOrKling) {
        // FLUX on OpenAI-compat proxies: pass width/height and seed
        const [w, h] = size.split('x').map(Number);
        payload['width'] = w || 1024;
        payload['height'] = h || 1024;
        payload['seed'] = Math.floor(Math.random() * 1_000_000);
        delete payload['size'];
        delete payload['n'];
      } else {
        payload['response_format'] = 'b64_json';
      }
      return payload;
    }
  }
}

async function pollForImage(
  pollingUrl: string,
  headers: Record<string, string>,
  maxAttempts = 30,
  intervalMs = 3000,
): Promise<string> {
  const isLikelyImageUrl = (value: unknown): value is string => {
    if (typeof value !== 'string' || value.length === 0) return false;
    if (value.startsWith('data:image/')) return true;
    if (!/^https?:\/\//i.test(value)) return false;
    const lower = value.toLowerCase();
    if (lower.includes('/videos/')) return false;
    if (lower.includes('/images/')) return true;
    if (/(\.png|\.jpg|\.jpeg|\.webp|\.gif)(\?|$)/i.test(lower)) return true;
    if (/(\bformat=png\b|\bformat=jpg\b|\bformat=jpeg\b|\bformat=webp\b)/i.test(lower)) return true;
    return false;
  };

  const collectImageUrls = (node: unknown, out: string[], depth = 0): void => {
    if (depth > 6 || node == null) return;
    if (typeof node === 'string') { if (isLikelyImageUrl(node)) out.push(node); return; }
    if (Array.isArray(node)) { for (const item of node) collectImageUrls(item, out, depth + 1); return; }
    if (typeof node === 'object') {
      for (const value of Object.values(node as Record<string, unknown>)) {
        collectImageUrls(value, out, depth + 1);
      }
    }
  };

  const selectBestImageUrl = (payload: Record<string, unknown>): string | null => {
    type P = Record<string, unknown> & {
      data?: Record<string, unknown> & {
        output?: unknown;
        result?: { images?: Array<{ url?: string }> };
        images?: Array<{ url?: string }>;
        image_url?: string;
      };
      images?: Array<{ url?: string }>;
      image_url?: string;
    };
    const p = payload as P;
    const directCandidates: unknown[] = [
      payload['output'],
      p.data?.['output'],
      p.data?.result?.images?.[0]?.url,
      p.data?.images?.[0]?.url,
      p.images?.[0]?.url,
      p.image_url,
      p.data?.image_url,
    ];
    for (const c of directCandidates) {
      if (typeof c === 'string' && isLikelyImageUrl(c)) return c;
      if (Array.isArray(c)) {
        const first = c.find((item) => typeof item === 'string' && isLikelyImageUrl(item));
        if (typeof first === 'string') return first;
      }
    }
    const deep: string[] = [];
    collectImageUrls(payload, deep);
    return deep[0] ?? null;
  };

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    const response = await fetch(pollingUrl, { headers });
    if (!response.ok) throw new Error(`Polling failed: ${response.status}`);

    const data = await readJsonResponse(response, 'Image polling failed');
    const topStatus = typeof data['status'] === 'string' ? data['status'] : '';
    const nestedStatus =
      typeof (data['data'] as Record<string, unknown> | undefined)?.['status'] === 'string'
        ? (data['data'] as Record<string, unknown>)['status'] as string
        : '';
    const unifiedStatus = (topStatus || nestedStatus).toLowerCase();

    if (['ready', 'succeeded', 'success', 'completed'].includes(unifiedStatus)) {
      const best = selectBestImageUrl(data);
      if (best) return best;
      const resultUrl = (data['data'] as Record<string, unknown> | undefined)?.['result_url'] ?? data['result_url'];
      if (typeof resultUrl === 'string' && resultUrl.length > 0) return resultUrl;
    }

    if (['failed', 'canceled', 'error'].includes(unifiedStatus)) {
      throw new Error(`Generation failed: ${String(data['error'] ?? 'Unknown error')}`);
    }

    // Kling format
    const klingData = data['data'] as Record<string, unknown> | undefined;
    const klingStatus = klingData?.['status'] ?? klingData?.['task_status'];
    const klingUpper = typeof klingStatus === 'string' ? klingStatus.toUpperCase() : '';

    if (['SUCCEED', 'SUCCESS', 'COMPLETED'].includes(klingUpper)) {
      const kResult = klingData?.['data'] as Record<string, unknown> | undefined;
      const imageUrl =
        (kResult?.['task_result'] as Record<string, unknown> | undefined)?.['images'] ||
        klingData?.['task_result'] ||
        klingData?.['result'] ||
        klingData?.['images'];
      const arr = Array.isArray(imageUrl) ? imageUrl : [];
      const firstImg = (arr[0] as Record<string, unknown> | undefined)?.['url'];
      if (typeof firstImg === 'string') return firstImg;
    }

    if (['FAILED', 'ERROR'].includes(klingUpper)) {
      throw new Error(`Generation failed: ${String(klingData?.['fail_reason'] ?? 'Unknown error')}`);
    }
  }

  throw new Error(`Polling timeout after ${maxAttempts * intervalMs / 1000}s — image generation took too long`);
}

function extractImageFromResponse(data: Record<string, unknown>, family: ImageModelFamily): string | null {
  switch (family) {
    case 'openai-standard': {
      const d = data as OpenAIImageResponse;
      const img = d.data?.[0];
      if (img?.b64_json) return `data:image/png;base64,${img.b64_json}`;
      if (img?.url) return img.url;
      // Some proxies return url at top level
      if (typeof data['url'] === 'string') return data['url'];
      return null;
    }
    case 'doubao':
    case 'qwen': {
      const d = data as DoubaoQwenImageResponse;
      if (d.data?.[0]?.b64_json) return `data:image/png;base64,${d.data[0].b64_json}`;
      if (d.data?.[0]?.url) return d.data[0].url;
      if (d.image) return d.image.startsWith('data:') ? d.image : `data:image/png;base64,${d.image}`;
      return null;
    }
    default:
      return null;
  }
}

@Injectable()
export class ImageGenerationService {
  private readonly logger = new Logger(ImageGenerationService.name);

  async generate(req: ImageGenerationRequest): Promise<ImageGenerationResult> {
    const model = req.model ?? 'flux-schnell';
    const size = req.size ?? '1024x1024';
    const quality = req.quality ?? 'low';
    const outputFormat = req.output_format ?? 'png';

    if (isMockStockModel(model)) {
      const stockUrl = buildMockStockUrl(req.prompt, size);
      this.logger.log(`[ImageGen] mock-stock -> ${stockUrl}`);
      const fetched = await fetchAndConvertImage(stockUrl);
      return {
        buffer: fetched.buffer,
        mimeType: fetched.mimeType,
        dataUrl: fetched.dataUrl,
        model,
        size,
        format: formatFromMimeType(fetched.mimeType),
      };
    }

    const baseUrl = resolveBaseUrl(req.provider, req.baseUrl, model);

    this.logger.log(`[ImageGen] ${model} @ ${baseUrl} (quality=${quality}, provider=${req.provider ?? 'auto'})`);

    const config = getModelConfig(model, baseUrl, req.apiKey, req.provider);
    this.logger.log(`[ImageGen] family=${config.family} polling=${config.requiresPolling} endpoint=${config.endpoint}`);

    const payload = buildImagePayload(config.family, model, req.prompt, size, quality, outputFormat);

    const response = await fetch(config.endpoint, {
      method: 'POST',
      headers: config.headers,
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorData = await readImageApiError(response);
      const msg = errorData?.error?.message ?? `HTTP ${response.status}`;
      throw new Error(`Image generation failed: ${msg}`);
    }

    const data = await readJsonResponse(response, 'Image generation failed');

    if (config.requiresPolling) {
      const initResp = data as PollingInitResponse;
      let pollingUrl: string | undefined =
        initResp.polling_url ?? initResp.urls?.get ?? initResp.url ?? initResp.data?.polling_url;

      if (config.family === 'kling' && initResp.data?.task_id) {
        pollingUrl = `${config.pollingEndpoint}/${initResp.data.task_id}`;
      }

      // Replicate native: rewrite api.replicate.com → configured baseUrl proxy
      if (typeof pollingUrl === 'string' && pollingUrl.includes('api.replicate.com')) {
        pollingUrl = pollingUrl.replace(
          'https://api.replicate.com/v1',
          baseUrl,
        );
      }

      if (!pollingUrl) throw new Error('No polling URL or task_id received for async model');

      this.logger.log(`[ImageGen] Polling for ${config.family} at ${pollingUrl}`);
      const imageUrl = await pollForImage(pollingUrl, config.headers);
      const fetched = await fetchAndConvertImage(imageUrl, config.headers);
      return { buffer: fetched.buffer, mimeType: fetched.mimeType, dataUrl: fetched.dataUrl, model, size, format: outputFormat };
    }

    const imageData = extractImageFromResponse(data, config.family);
    if (imageData) {
      const fetched = await fetchAndConvertImage(imageData, config.headers);
      return { buffer: fetched.buffer, mimeType: fetched.mimeType, dataUrl: fetched.dataUrl, model, size, format: outputFormat };
    }

    this.logger.error(`[ImageGen] Unexpected response structure`, JSON.stringify(data).slice(0, 300));
    throw new Error('No image data in response');
  }
}
