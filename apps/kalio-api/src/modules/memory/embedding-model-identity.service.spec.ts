import { afterEach, describe, expect, it, vi } from 'vitest';
import { EmbeddingModelIdentityService } from './embedding-model-identity.service';

const digest = 'a'.repeat(64);
const unresolved = { modelRevision: 'unresolved', providerScope: 'unresolved' };
const resolver = new EmbeddingModelIdentityService();
function tags(models: unknown) { return new Response(JSON.stringify({ models })); }
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
describe('loopback Ollama immutable metadata identity', () => {
  it('uses exact model digest, normalizes default latest, and scopes endpoint and credential without secrets', async () => {
    const fetchMock = vi.fn(async (_url: string, _options: RequestInit) => tags([{ name: 'model:latest', digest }])); vi.stubGlobal('fetch', fetchMock);
    const first = await resolver.resolve('http://localhost:11434/', 'model', 'credential:one');
    expect(first.modelRevision).toBe(digest);
    expect(first.providerScope).toMatch(/^scope-[a-f0-9]{64}$/);
    expect(await resolver.resolve('http://localhost:11434', 'model:latest', 'credential:one')).toEqual(first);
    expect((await resolver.resolve('http://localhost:11434', 'model', 'credential:two')).providerScope).not.toBe(first.providerScope);
    expect((await resolver.resolve('http://127.0.0.1:11434', 'model', 'credential:one')).providerScope).not.toBe(first.providerScope);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://localhost:11434/api/tags');
  });
  it.each(['http://my-ollama:11434', 'https://localhost.example.test', 'http://10.0.0.1:11434',
    'file:///model', 'http://user:key@localhost:11434', 'http://localhost:11434/?key=secret'])('never requests non-loopback or credential-bearing URL %s', async url => {
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    expect(await resolver.resolve(url, 'model', 'env')).toEqual(unresolved);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each([[], [{ name: 'other:latest', digest }], [{ name: 'model:latest', digest: 'mutable' }],
    [{ name: 'model:latest', digest }, { name: 'model:latest', digest }]].map(models => ({ models })))('fails closed on absent, ambiguous or invalid model metadata %j', async ({ models }) => {
    vi.stubGlobal('fetch', vi.fn(async () => tags(models)));
    expect(await resolver.resolve('http://localhost:11434', 'model', 'env')).toEqual(unresolved);
  });
  it('bounds response bytes and rejects HTTP failures and malformed JSON', async () => {
    for (const response of [new Response('x', { status: 500 }), new Response('{'),
      new Response('x', { headers: { 'content-length': '1048577' } }), new Response('x'.repeat(1048577))]) {
      vi.stubGlobal('fetch', vi.fn(async () => response));
      expect(await resolver.resolve('http://localhost:11434', 'model', 'env')).toEqual(unresolved);
    }
  });
  it('rejects redirects and times out metadata with no inference request', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((_url: string, options: RequestInit) => new Promise<Response>((_resolve, reject) => {
      expect(options.redirect).toBe('error');
      options.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    })); vi.stubGlobal('fetch', fetchMock);
    const pending = resolver.resolve('http://localhost:11434', 'model', 'env');
    await vi.advanceTimersByTimeAsync(2000);
    expect(await pending).toEqual(unresolved);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
