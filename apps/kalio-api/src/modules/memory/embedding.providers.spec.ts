import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenAICompatibleEmbeddingProvider, OllamaEmbeddingProvider, EMBEDDING_PROVIDER_TIMEOUT_MS } from './embedding.providers';

describe('embedding provider output validation', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });
  const openai = () => new OpenAICompatibleEmbeddingProvider({ apiKey: 'test', baseUrl: 'https://example.test', model: 'exact', dimensions: 2 });
  it('sorts exact OpenAI indices without modifying embedding values', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [
      { index: 1, embedding: [3, 4] }, { index: 0, embedding: [1, 2] }] }) }));
    expect(await openai().embed(['a', 'b'])).toEqual([[1, 2], [3, 4]]);
  });
  it.each([
    [{ index: 0, embedding: [1, 2] }, { index: 0, embedding: [3, 4] }],
    [{ index: 1, embedding: [1, 2] }], [{ index: 0, embedding: [1, 2, 3] }],
    [{ index: 0, embedding: [NaN, 2] }], [{ index: 0, embedding: [Infinity, 2] }],
  ].map(data => ({ data })))('rejects invalid OpenAI indices/count/vector without truncation %j', async ({ data }) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data }) }));
    await expect(openai().embed(['a'])).rejects.toThrow('EMBEDDING_VECTORS_INVALID');
  });
  it('does not accept a single legacy Ollama vector for a multi-input request', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ embedding: [1, 2] }) }));
    await expect(new OllamaEmbeddingProvider('http://localhost:11434', 'exact', 2).embed(['a', 'b']))
      .rejects.toThrow('EMBEDDING_VECTORS_INVALID');
  });
  it.each(['openai', 'ollama'])('bounds a stalled %s fetch with the provider timeout signal', async provider => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockImplementation(milliseconds => {
      setTimeout(() => controller.abort(new Error('TEST_EMBEDDING_TIMEOUT')), milliseconds);
      return controller.signal;
    });
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal!.addEventListener('abort', () => reject(init.signal!.reason), { once: true });
    })));
    const instance = provider === 'openai' ? openai() : new OllamaEmbeddingProvider('http://localhost:11434', 'exact', 2);
    const result = expect(instance.embed(['a'])).rejects.toThrow('TEST_EMBEDDING_TIMEOUT');
    expect(timeout).toHaveBeenCalledExactlyOnceWith(EMBEDDING_PROVIDER_TIMEOUT_MS);
    await vi.advanceTimersByTimeAsync(EMBEDDING_PROVIDER_TIMEOUT_MS);
    await result;
  });
});
