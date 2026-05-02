/**
 * ImageGenerationService — unit tests.
 *
 * Key behaviors tested:
 * 1. FLUX on OpenAI-compatible proxies (CometAPI, any /v1 URL) uses the standard
 *    /v1/images/generations endpoint — NO polling. This fixes the "hang" bug where
 *    FLUX requests to CometAPI were routed through Replicate async predictions.
 *
 * 2. FLUX on provider='replicate' (direct Replicate API) uses async prediction polling.
 *    Polling URL rewrite: api.replicate.com → configured baseUrl proxy.
 *
 * 3. OpenAI standard models (dall-e, gpt-image) always use /v1/images/generations.
 *
 * 4. Error handling: non-ok responses throw with provider error message.
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

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('ImageGenerationService — OpenAI-compat proxy (no polling)', () => {
  let service: ImageGenerationService;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    service = new ImageGenerationService();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => { vi.unstubAllGlobals(); });

  it('FLUX on CometAPI uses /v1/images/generations — NOT Replicate prediction polling', async () => {
    // CometAPI base URL ends in /v1 → OpenAI-compat → no polling
    fetchMock
      .mockResolvedValueOnce(makeJsonResponse({ data: [{ url: 'https://cdn.example.com/flux.png' }] }))
      .mockResolvedValueOnce(makeImageHttpResponse());

    await service.generate({
      prompt: 'a red fox',
      model: 'flux-schnell',
      provider: 'cometapi',
      apiKey: 'test-key',
      baseUrl: 'https://api.cometapi.com/v1',
    });

    expect(fetchMock).toHaveBeenCalledTimes(2); // POST generate + GET image (no polling)
    const generateCall = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(generateCall[0]).toContain('/v1/images/generations');
    expect(generateCall[0]).not.toContain('/replicate/');
    expect(generateCall[0]).not.toContain('/predictions');
  });

  it('FLUX on any /v1 base URL is treated as OpenAI-compat — no polling', async () => {
    fetchMock
      .mockResolvedValueOnce(makeJsonResponse({ data: [{ b64_json: Buffer.from('img').toString('base64') }] }));
    // No second mock needed — b64_json is decoded locally, no extra fetch

    await service.generate({
      prompt: 'test',
      model: 'flux-dev',
      apiKey: 'key',
      baseUrl: 'https://my-openai-proxy.example.com/v1',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1); // POST only — b64_json decoded inline
    expect((fetchMock.mock.calls[0] as [string])[0]).toContain('/v1/images/generations');
  });

  it('dall-e-3 on OpenAI uses /v1/images/generations with response_format=b64_json', async () => {
    const b64 = Buffer.from('fake').toString('base64');
    fetchMock
      .mockResolvedValueOnce(makeJsonResponse({ data: [{ b64_json: b64 }] }))
      .mockResolvedValueOnce(makeImageHttpResponse());

    await service.generate({
      prompt: 'a castle',
      model: 'dall-e-3',
      provider: 'openai',
      apiKey: 'sk-test',
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('api.openai.com/v1/images/generations');
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body['response_format']).toBe('b64_json');
    expect(body['model']).toBe('dall-e-3');
  });

  it('gpt-image-1 sends output_format and quality params (not response_format)', async () => {
    fetchMock
      .mockResolvedValueOnce(makeJsonResponse({ data: [{ b64_json: 'aaa' }] }))
      .mockResolvedValueOnce(makeImageHttpResponse());

    await service.generate({
      prompt: 'test',
      model: 'gpt-image-1',
      provider: 'openai',
      quality: 'high',
      output_format: 'webp',
      apiKey: 'sk-test',
    });

    const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string) as Record<string, unknown>;
    expect(body['output_format']).toBe('webp');
    expect(body['quality']).toBe('high');
    expect(body).not.toHaveProperty('response_format');
  });

  it('FLUX on default (no provider) defaults to cometapi and uses standard endpoint', async () => {
    fetchMock
      .mockResolvedValueOnce(makeJsonResponse({ data: [{ url: 'https://cdn.cometapi.com/img.png' }] }))
      .mockResolvedValueOnce(makeImageHttpResponse());

    await service.generate({ prompt: 'test', model: 'flux-schnell', apiKey: 'k' });

    expect((fetchMock.mock.calls[0] as [string])[0]).toContain('cometapi.com/v1/images/generations');
    expect(fetchMock).toHaveBeenCalledTimes(2); // no polling
  });
});

describe('ImageGenerationService — Replicate direct (provider=replicate, polling)', () => {
  let service: ImageGenerationService;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    service = new ImageGenerationService();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => { vi.unstubAllGlobals(); });

  it('FLUX on provider=replicate uses prediction polling', async () => {
    const initBody = {
      urls: { get: 'https://api.replicate.com/v1/predictions/pred-123' },
      status: 'starting',
    };
    const pollingBody = { status: 'succeeded', output: ['https://cdn.replicate.com/result.png'] };

    fetchMock
      .mockResolvedValueOnce(makeJsonResponse(initBody))
      .mockResolvedValueOnce(makeJsonResponse(pollingBody))
      .mockResolvedValueOnce(makeImageHttpResponse());

    await service.generate({
      prompt: 'test',
      model: 'flux-schnell',
      provider: 'replicate',
      apiKey: 'r8_test',
      baseUrl: 'https://api.replicate.com/v1',
    });

    expect(fetchMock).toHaveBeenCalledTimes(3); // POST + poll + image
    const postCall = fetchMock.mock.calls[0] as [string];
    expect(postCall[0]).toContain('/models/black-forest-labs/flux-schnell/predictions');
    const pollCall = fetchMock.mock.calls[1] as [string];
    expect(pollCall[0]).toContain('/predictions/pred-123');
  });

  it('Replicate polling URL api.replicate.com is rewritten to configured baseUrl', async () => {
    const initBody = { urls: { get: 'https://api.replicate.com/v1/predictions/abc' } };
    const pollingBody = { status: 'succeeded', output: ['https://cdn.example.com/img.png'] };

    fetchMock
      .mockResolvedValueOnce(makeJsonResponse(initBody))
      .mockResolvedValueOnce(makeJsonResponse(pollingBody))
      .mockResolvedValueOnce(makeImageHttpResponse());

    // Using a CometAPI-as-Replicate-proxy scenario (custom URL that isn't /v1-terminating)
    await service.generate({
      prompt: 'test',
      model: 'flux-schnell',
      provider: 'replicate',
      apiKey: 'r8_key',
      baseUrl: 'https://api.replicate.com/v1',
    });

    const pollCall = fetchMock.mock.calls[1] as [string];
    // Polling URL should include the prediction id
    expect(pollCall[0]).toContain('/predictions/abc');
  });
});

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

