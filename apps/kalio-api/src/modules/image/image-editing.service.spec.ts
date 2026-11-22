import { describe, it, expect, vi, afterEach } from 'vitest';
import { ImageEditingService } from './image-editing.service';
import type { ImageEditRequest } from '@kalio/types';

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aC1sAAAAASUVORK5CYII=';
const request: ImageEditRequest = { config: { provider: 'chatgpt', executionProfileId: 'profile', source: 'db' }, prompt: 'change background',
  references: [{ ref: { vfsPath: 'base.png', role: 'base', label: 'source' }, base64: png, mimeType: 'image/png' }], aspectRatio: '1:1', imageSize: '1K', thinkingLevel: 'minimal' };
afterEach(() => vi.unstubAllGlobals());
describe('Central image editing dispatch', () => {
  it('uses native integration without API calls or API key and retains reference roles', async () => {
    const generate = vi.fn().mockResolvedValue({ bytes: Buffer.from(png, 'base64'), mimeType: 'image/png', format: 'png', model: 'native', width: 1, height: 1 });
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    await new ImageEditingService({ generate }).edit(request);
    expect(generate).toHaveBeenCalledWith(expect.objectContaining({ executionProfileId: 'profile', references: [{ dataUrl: `data:image/png;base64,${png}`, label: 'source', role: 'base' }] }));
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(['openrouter', 'replicate'] as const)('rejects unsupported %s without fallback', async provider => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    await expect(new ImageEditingService({ generate: vi.fn() }).edit({ ...request, config: { provider, source: 'db' }, apiKey: 'key' })).rejects.toThrow('not supported');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('uses multipart OpenAI edits with the configured editing model', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [{ b64_json: png }] }), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    const result = await new ImageEditingService({ generate: vi.fn() }).edit({ ...request, config: { provider: 'openai', editModel: 'gpt-image-1', source: 'db' }, apiKey: 'key' });
    const [url, options] = fetch.mock.calls[0]!;
    expect(url).toBe('https://api.openai.com/v1/images/edits');
    expect((options.body as FormData).get('model')).toBe('gpt-image-1');
    expect((options.body as FormData).get('size')).toBe('1024x1024');
    expect((options.body as FormData).getAll('image[]')).toHaveLength(1);
    expect(options.headers).toEqual({ Authorization: 'Bearer key' });
    expect(result).toMatchObject({ format: 'png', width: 1, height: 1 });
  });

  it('does not send a generation-only OpenAI model to edits', async () => {
    await expect(new ImageEditingService({ generate: vi.fn() }).edit({ ...request, config: { provider: 'openai', source: 'db' }, apiKey: 'key', model: 'dall-e-3' })).rejects.toThrow('does not support');
  });
});
