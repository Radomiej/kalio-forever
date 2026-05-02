/**
 * ImageGenerationService — unit tests.
 *
 * FLUX routing:
 *   - CometAPI / unknown proxies → /replicate/v1/models/.../predictions (async polling)
 *   - Native Replicate (api.replicate.com) → /v1/models/.../predictions (async polling)
 *   - OpenRouter / OpenAI → /v1/images/generations (standard, no polling)
 *
 * OpenAI standard models (dall-e, gpt-image) always use standard endpoint.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ImageGenerationService } from './image-generation.service';

// ── Helpers ────────────────────────────────────────────────────────────────────

const FAKE_PNG_BUFFER = Buffer.from('PNG');

function makeImageHttpResponse() {
  return {
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': 'image/png' }),
    arrayBuffer: async () => FAKE_PNG_BUFFER.buffer,
  };
}

function makeJsonResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function pollingFlow(predictionId = 'pred-123', imageUrl = 'https://cdn.example.com/result.png') {
  return {
    init: { urls: { get: `https://api.replicate.com/v1/predictions/${predictionId}` }, status: 'starting' },
    poll: { status: 'succeeded', output: [imageUrl] },
  };
}

// ── CometAPI FLUX: standard endpoint ───────────────────────────────────────────

describe('ImageGenerationService — CometAPI FLUX (standard endpoint)', () => {
  let service: ImageGenerationService;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    service = new ImageGenerationService();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('FLUX on CometAPI uses /v1/images/generations without polling', async () => {
    fetchMock.mockResolvedValueOnce(makeJsonResponse({
      data: [{ b64_json: Buffer.from('img').toString('base64') }],
    }));

    await service.generate({
      prompt: 'a red fox',
      model: 'flux-schnell',
      provider: 'cometapi',
      apiKey: 'test-key',
      baseUrl: 'https://api.cometapi.com/v1',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [postUrl, postInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(postUrl).toContain('/v1/images/generations');
    expect(postUrl).not.toContain('/predictions');
    const body = JSON.parse(postInit.body as string) as Record<string, unknown>;
    expect(body['model']).toBe('flux-schnell');
    expect(body).toHaveProperty('width');
    expect(body).toHaveProperty('height');
  });

  it('FLUX on CometAPI with no explicit provider also uses the standard endpoint', async () => {
    fetchMock.mockResolvedValueOnce(makeJsonResponse({
      data: [{ b64_json: Buffer.from('img').toString('base64') }],
    }));

    await service.generate({ prompt: 'test', model: 'flux-schnell', apiKey: 'k' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [postUrl] = fetchMock.mock.calls[0] as [string];
    expect(postUrl).toContain('cometapi.com/v1/images/generations');
  });

  it('FLUX on unknown /v1 proxy URL also uses the standard endpoint', async () => {
    fetchMock.mockResolvedValueOnce(makeJsonResponse({
      data: [{ b64_json: Buffer.from('img').toString('base64') }],
    }));

    await service.generate({
      prompt: 'test',
      model: 'flux-dev',
      apiKey: 'key',
      baseUrl: 'https://my-custom-proxy.example.com/v1',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [postUrl] = fetchMock.mock.calls[0] as [string];
    expect(postUrl).toContain('/v1/images/generations');
    expect(postUrl).not.toContain('/predictions');
  });
});

// ── Native Replicate FLUX ──────────────────────────────────────────────────────

describe('ImageGenerationService — Native Replicate FLUX (provider=replicate)', () => {
  let service: ImageGenerationService;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    service = new ImageGenerationService();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('FLUX on provider=replicate uses /v1/models/... (no /replicate/ prefix)', async () => {
    const { init, poll } = pollingFlow('pred-native');
    fetchMock
      .mockResolvedValueOnce(makeJsonResponse(init))
      .mockResolvedValueOnce(makeJsonResponse(poll))
      .mockResolvedValueOnce(makeImageHttpResponse());

    await service.generate({
      prompt: 'test',
      model: 'flux-schnell',
      provider: 'replicate',
      apiKey: 'r8_test',
      baseUrl: 'https://api.replicate.com/v1',
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const [postUrl] = fetchMock.mock.calls[0] as [string];
    expect(postUrl).toContain('api.replicate.com/v1/models/black-forest-labs/flux-schnell/predictions');
    expect(postUrl).not.toMatch(/\/replicate\/v1\/models/); // no extra /replicate/ prefix
  });
});

// ── OpenRouter FLUX: standard endpoint ────────────────────────────────────────

describe('ImageGenerationService — OpenRouter FLUX (standard endpoint)', () => {
  let service: ImageGenerationService;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    service = new ImageGenerationService();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('FLUX on OpenRouter uses standard /v1/images/generations — no polling', async () => {
    fetchMock
      .mockResolvedValueOnce(makeJsonResponse({ data: [{ b64_json: Buffer.from('img').toString('base64') }] }));

    await service.generate({
      prompt: 'test',
      model: 'flux-dev',
      provider: 'openrouter',
      apiKey: 'key',
      baseUrl: 'https://openrouter.ai/api/v1',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1); // POST only, no polling
    const [postUrl] = fetchMock.mock.calls[0] as [string];
    expect(postUrl).toContain('/v1/images/generations');
    expect(postUrl).not.toContain('/predictions');
  });
});

// ── OpenAI standard models ─────────────────────────────────────────────────────

describe('ImageGenerationService — OpenAI standard models', () => {
  let service: ImageGenerationService;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    service = new ImageGenerationService();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('dall-e-3 uses /v1/images/generations with response_format=b64_json', async () => {
    const b64 = Buffer.from('fake').toString('base64');
    fetchMock.mockResolvedValueOnce(makeJsonResponse({ data: [{ b64_json: b64 }] }));

    await service.generate({ prompt: 'a castle', model: 'dall-e-3', provider: 'openai', apiKey: 'sk-test' });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('api.openai.com/v1/images/generations');
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body['response_format']).toBe('b64_json');
  });

  it('gpt-image-1 sends output_format and quality params (not response_format)', async () => {
    fetchMock.mockResolvedValueOnce(makeJsonResponse({ data: [{ b64_json: 'aaa' }] }));

    await service.generate({
      prompt: 'test', model: 'gpt-image-1', provider: 'openai',
      quality: 'high', output_format: 'webp', apiKey: 'sk-test',
    });

    const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string) as Record<string, unknown>;
    expect(body['output_format']).toBe('webp');
    expect(body['quality']).toBe('high');
    expect(body).not.toHaveProperty('response_format');
  });
});

// ── Error handling ─────────────────────────────────────────────────────────────

describe('ImageGenerationService — error handling', () => {
  let service: ImageGenerationService;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    service = new ImageGenerationService();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('throws with provider error message on HTTP error', async () => {
    fetchMock.mockResolvedValueOnce(
      makeJsonResponse({ error: { message: 'quota exceeded' } }, false, 429),
    );
    await expect(
      service.generate({ prompt: 'test', model: 'dall-e-3', apiKey: 'k', provider: 'openai' }),
    ).rejects.toThrow('quota exceeded');
  });

  it('throws when response has no image data', async () => {
    fetchMock.mockResolvedValueOnce(makeJsonResponse({ data: [] }));
    await expect(
      service.generate({ prompt: 'test', model: 'dall-e-3', apiKey: 'k', provider: 'openai' }),
    ).rejects.toThrow('No image data in response');
  });
});
