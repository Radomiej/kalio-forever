import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { EmbeddingService, OllamaEmbeddingProvider } from './embedding.service';
import type { EmbeddingCredentialsService } from './embedding-credentials.service';
import type { EmbeddingModelIdentityService } from './embedding-model-identity.service';
import { ProjectContextSettingsController } from './project-context-settings.controller';
import type { ProjectContextSettingsService } from './project-context-settings.service';
import { LocalTransformersEmbeddingProvider } from './local-transformers-embedding.provider';

function service(model = 'embeddinggemma2', baseUrl = 'http://localhost:11434', revision = '') {
  const env: Record<string, string> = { EMBEDDING_API_KEY: 'test-secret', EMBEDDING_BASE_URL: baseUrl,
    EMBEDDING_MODEL: model, EMBEDDING_DIMENSIONS: '2', EMBEDDING_MODEL_REVISION: revision };
  const credentials = { getProjectContextIdentity: vi.fn().mockResolvedValue(null), getActiveConfig: vi.fn().mockResolvedValue(null),
    getLocalConfig: vi.fn(async (defaults: unknown) => defaults), shouldForceLocal: vi.fn().mockResolvedValue(false) };
  const config = { get: (key: string, fallback: unknown) => env[key] ?? fallback } as unknown as ConfigService;
  const identities = { resolve: vi.fn(async (_url: string, _model: string, _owner: string) => ({ modelRevision: 'a'.repeat(64), providerScope: 'test-scope' })) };
  const svc = new EmbeddingService(config, credentials as unknown as EmbeddingCredentialsService, identities as EmbeddingModelIdentityService);
  const reload = svc.reloadFromCredential.bind(svc);
  svc.reloadFromCredential = async () => { await reload(); await svc.ensureCurrentIdentity(); };
  return { svc, env, credentials, identities };
}

describe('pinned embedding spaces', () => {
  it('never trusts global manual identity for a newly selected model', async () => {
    const f = service();
    f.credentials.getProjectContextIdentity.mockResolvedValue({ modelRevision: 'persisted-rev', providerScope: 'local-user' });
    await f.svc.reloadFromCredential();
    expect(f.svc.captureSpace()).toMatchObject({ modelRevision: 'a'.repeat(64), providerScope: 'test-scope', model: 'embeddinggemma2', provider: 'ollama' });
    f.env.EMBEDDING_MODEL = 'next-model'; f.env.EMBEDDING_MODEL_REVISION = 'old-revision';
    f.identities.resolve.mockResolvedValue({ modelRevision: 'unresolved', providerScope: 'unresolved' });
    await f.svc.reloadFromCredential();
    expect(f.svc.captureSpace()).toMatchObject({ model: 'next-model', modelRevision: 'unresolved', providerScope: 'unresolved' });
    expect(f.credentials.getProjectContextIdentity).not.toHaveBeenCalled();
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
  it('preserves unresolved ordinary memory for local Transformers without inspecting or downloading artifacts', async () => {
    const f = service(); f.env.EMBEDDING_FORCE_LOCAL = 'true'; f.env.EMBEDDING_LOCAL_DIMENSIONS = '2';
    const providerEmbed = vi.spyOn(LocalTransformersEmbeddingProvider.prototype, 'embed').mockResolvedValue([[1, 2]]);
    const svc = new EmbeddingService(new ConfigService(f.env), f.credentials as unknown as EmbeddingCredentialsService);
    await svc.reloadFromCredential();
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    const space = svc.captureSpace();
    expect(space).toMatchObject({ provider: 'local-transformers', modelRevision: 'unresolved', providerScope: 'unresolved' });
    expect(await svc.embedPinned(space, ['ordinary memory'])).toEqual([[1, 2]]);
    expect(providerEmbed).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
    await svc.onModuleDestroy();
  });
  it('preserves unresolved ordinary mock memory without inventing a trusted project identity', async () => {
    const f = service(); f.env.EMBEDDING_PROVIDER = 'mock';
    const svc = new EmbeddingService(new ConfigService(f.env), f.credentials as unknown as EmbeddingCredentialsService);
    await svc.reloadFromCredential();
    const space = svc.captureSpace();
    expect(space).toMatchObject({ provider: 'mock', modelRevision: 'unresolved', providerScope: 'unresolved' });
    const result = await svc.embedPinned(space, ['ordinary memory']);
    expect(result).toHaveLength(1); expect(result[0]).toHaveLength(space.dimensions);
  });
  it('keeps configured remote providers unresolved without making metadata or inference requests', async () => {
    const f = service('remote-model', 'https://example.test');
    await f.svc.reloadFromCredential();
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    expect(await f.svc.ensureCurrentIdentity()).toEqual({ modelRevision: 'unresolved', providerScope: 'unresolved' });
    expect(f.svc.getStatus()).toMatchObject({ configured: true, provider: 'openai-compatible' });
    expect(f.identities.resolve).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('fails closed with the optional default resolver instead of inventing mock identity', async () => {
    const f = service();
    const config = new ConfigService(f.env);
    const svc = new EmbeddingService(config, f.credentials as unknown as EmbeddingCredentialsService);
    await svc.reloadFromCredential();
    const fetchMock = vi.fn().mockRejectedValue(new Error('metadata unavailable')); vi.stubGlobal('fetch', fetchMock);
    expect(await svc.ensureCurrentIdentity()).toEqual({ modelRevision: 'unresolved', providerScope: 'unresolved' });
    expect(svc.captureSpace().modelRevision).toBe('unresolved');
    expect(svc.getStatus().configured).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('aborts when digest changes before or after inference', async () => {
    for (const after of [false, true]) {
      const f = service(); await f.svc.reloadFromCredential(); const space = f.svc.captureSpace();
      const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ embeddings: [[1, 2]] }) });
      vi.stubGlobal('fetch', fetchMock);
      if (after) f.identities.resolve.mockResolvedValueOnce({ modelRevision: 'a'.repeat(64), providerScope: 'test-scope' });
      f.identities.resolve.mockResolvedValue({ modelRevision: 'b'.repeat(64), providerScope: 'test-scope' });
      await expect(f.svc.embedPinned(space, ['hello'])).rejects.toThrow('EMBEDDING_SPACE_CHANGED');
      expect(fetchMock).toHaveBeenCalledTimes(after ? 1 : 0);
    }
  });
  it('rejects late metadata after reload but coalesces identical concurrent refreshes', async () => {
    const f = service(); await f.svc.reloadFromCredential();
    let done!: (value: { modelRevision: string; providerScope: string }) => void;
    f.identities.resolve.mockImplementationOnce(() => new Promise(resolve => { done = resolve; }));
    const pending = f.svc.ensureCurrentIdentity();
    const rejected = expect(pending).rejects.toThrow('EMBEDDING_SPACE_CHANGED');
    f.env.EMBEDDING_MODEL = 'next'; await f.svc.reloadFromCredential();
    done({ modelRevision: 'b'.repeat(64), providerScope: 'old' }); await rejected;
    expect(f.svc.captureSpace()).toMatchObject({ model: 'next', modelRevision: 'a'.repeat(64), providerScope: 'test-scope' });
    f.identities.resolve.mockImplementationOnce(() => new Promise(resolve => { done = resolve; }));
    const calls = f.identities.resolve.mock.calls.length;
    const before = f.svc.captureSpace();
    const competing = f.svc.ensureCurrentIdentity();
    const same = f.svc.ensureCurrentIdentity();
    expect(f.identities.resolve).toHaveBeenCalledTimes(calls + 1);
    done({ modelRevision: 'a'.repeat(64), providerScope: 'test-scope' });
    expect(await Promise.all([competing, same])).toEqual([
      { modelRevision: 'a'.repeat(64), providerScope: 'test-scope' },
      { modelRevision: 'a'.repeat(64), providerScope: 'test-scope' },
    ]);
    expect(f.svc.captureSpace()).toEqual(before);
  });
  it.each(['http://localhost:11434', 'https://example.test'])('preserves ordinary memory with unresolved identity at %s', async baseUrl => {
    const f = service('legacy-model', baseUrl);
    const svc = new EmbeddingService(new ConfigService(f.env), f.credentials as unknown as EmbeddingCredentialsService);
    await svc.reloadFromCredential();
    const fetchMock = vi.fn((_url: string, _options: RequestInit) => Promise.resolve({ ok: true, json: async () => baseUrl.startsWith('http://')
      ? ({ embeddings: [[1, 2]] }) : ({ data: [{ index: 0, embedding: [1, 2] }] }) }));
    vi.stubGlobal('fetch', fetchMock);
    const space = svc.captureSpace();
    expect(space.modelRevision).toBe('unresolved');
    expect(await svc.embedPinned(space, ['legacy memory'])).toEqual([[1, 2]]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).not.toContain('/api/tags');
    expect(svc.captureSpace()).toEqual(space);
  });
  it('coalesces settings GET with embedding metadata without invalidating an unchanged epoch', async () => {
    const f = service(); await f.svc.reloadFromCredential();
    const space = f.svc.captureSpace();
    let done!: (value: { modelRevision: string; providerScope: string }) => void;
    const calls = f.identities.resolve.mock.calls.length;
    f.identities.resolve.mockImplementationOnce(() => new Promise(resolve => { done = resolve; }));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ embeddings: [[1, 2]] }) }));
    const controller = new ProjectContextSettingsController({ get: async () => ({ enabled: true, modelRevision: 'unresolved', providerScope: 'unresolved' }) } as ProjectContextSettingsService, f.svc);
    const embedding = f.svc.embedPinned(space, ['memory']);
    const reads = [controller.get(), controller.get()];
    await vi.waitFor(() => expect(f.identities.resolve).toHaveBeenCalledTimes(calls + 1));
    done({ modelRevision: 'a'.repeat(64), providerScope: 'test-scope' });
    expect(await embedding).toEqual([[1, 2]]);
    expect(await Promise.all(reads)).toEqual([
      { enabled: true, modelRevision: 'a'.repeat(64), providerScope: 'test-scope' },
      { enabled: true, modelRevision: 'a'.repeat(64), providerScope: 'test-scope' },
    ]);
    expect(f.svc.captureSpace()).toEqual(space);
    expect(f.identities.resolve).toHaveBeenCalledTimes(calls + 2);
  });
  it.each(['http://127.0.0.1:11434', 'http://[::1]:11434', 'http://localhost:11434',
    'http://my-ollama:8080'])('selects Ollama transport for %s', async baseUrl => {
    const f = service('embeddinggemma-2:270m', baseUrl); await f.svc.reloadFromCredential();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ embeddings: [[1, 2]] }) });
    vi.stubGlobal('fetch', fetchMock);
    expect(f.svc.captureSpace().provider).toBe('ollama');
    await f.svc.embedPinned(f.svc.captureSpace(), ['hello']);
    expect(fetchMock.mock.calls[0]![0]).toBe(`${baseUrl}/api/embed`);
  });
  it.each(['http://127.0.0.1:11435', 'http://[::1]:8080', 'http://example.test:11434',
    'https://example.test/ollama', 'https://example.test/?target=localhost:11434',
    'https://localhost.example.test:11434'])('does not misclassify %s as Ollama', async baseUrl => {
    const f = service('exact', baseUrl); await f.svc.reloadFromCredential();
    expect(f.svc.captureSpace().provider).toBe('openai-compatible');
  });
  it('separates lossy model names, endpoints and model revisions', async () => {
    const cases = [service('a/b'), service('a-b'), service('a/b', 'http://localhost:11434/other'),
      service('different', 'http://localhost:11434', 'rev2')];
    for (const f of cases) await f.svc.reloadFromCredential();
    expect(new Set(cases.map(f => f.svc.getProfileId())).size).toBe(4);
  });
  it('captures a safe deterministic identity and excludes URL credentials/query', async () => {
    const a = service('exact-Model', 'http://user:secret@localhost:11434/?token=secret');
    const b = service('exact-Model', 'http://localhost:11434');
    await a.svc.reloadFromCredential(); await b.svc.reloadFromCredential();
    expect(a.svc.captureSpace()).toEqual(b.svc.captureSpace());
    expect(a.svc.captureSpace().id).toMatch(/^ollama-[a-f0-9]{64}$/);
    expect(JSON.stringify(a.svc.captureSpace())).not.toContain('secret');
  });
  it('ignores configured manual deployment scope', async () => {
    const a = service(); const b = service();
    b.env.EMBEDDING_PROVIDER_SCOPE = 'deployment-b';
    await a.svc.reloadFromCredential(); await b.svc.reloadFromCredential();
    expect(a.svc.captureSpace()).toMatchObject({ modelRevision: 'a'.repeat(64), providerScope: 'test-scope',
      documentPromptVersion: 'embeddinggemma2-document-v1', queryPromptVersion: 'embeddinggemma2-query-v1',
      codeQueryPromptVersion: 'embeddinggemma2-code-query-v1', normalizationVersion: 'provider-native-no-client-normalization-v1' });
    expect(a.svc.captureSpace().id).toBe(b.svc.captureSpace().id);
  });
  it('adds exact Gemma2 purpose prefixes, never to legacy embed methods', async () => {
    const f = service('embeddinggemma-2:270m'); await f.svc.reloadFromCredential();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ embeddings: [[1, 2]] }) });
    vi.stubGlobal('fetch', fetchMock);
    const space = f.svc.captureSpace();
    for (const purpose of ['document', 'query', 'code_query'] as const) await f.svc.embedPinned(space, ['hello'], purpose);
    await f.svc.embedOne('hello');
    expect(fetchMock.mock.calls.map(call => JSON.parse(call[1].body).input[0])).toEqual([
      'title: none | text: hello', 'task: search result | query: hello', 'task: code retrieval | query: hello', 'hello']);
    expect(space.id).not.toBe(f.svc.getProfileId());
  });
  it('rejects a profile reload during an in-flight request even when identity is unchanged', async () => {
    const f = service(); await f.svc.reloadFromCredential();
    let resolve!: (value: unknown) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise(done => { resolve = done; })));
    const pending = f.svc.embedPinned(f.svc.captureSpace(), ['hello']);
    await vi.waitFor(() => expect(resolve).toBeTypeOf('function'));
    await f.svc.reloadFromCredential();
    resolve({ ok: true, json: async () => ({ embeddings: [[1, 2]] }) });
    await expect(pending).rejects.toThrow('EMBEDDING_SPACE_CHANGED');
  });
  it.each([[], [[1]], [[1, 2, 3]], [[NaN, 2]], [[Infinity, 2]], [[1, 2], [3, 4]]].map(vectors => ({ vectors })))('rejects invalid vector output %j', async ({ vectors }) => {
    const f = service(); await f.svc.reloadFromCredential();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ embeddings: vectors }) }));
    await expect(f.svc.embedPinned(f.svc.captureSpace(), ['hello'])).rejects.toThrow();
  });
  it('sends requested dimensions and disables server truncation', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ embeddings: [[1, 2]] }) });
    vi.stubGlobal('fetch', fetchMock);
    await new OllamaEmbeddingProvider('http://localhost:11434', 'embeddinggemma2', 2).embed(['hello']);
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toEqual({ model: 'embeddinggemma2', input: ['hello'], dimensions: 2, truncate: false });
  });
  it('rejects stale or tampered captures before invoking the provider', async () => {
    const f = service(); await f.svc.reloadFromCredential();
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    const space = f.svc.captureSpace();
    for (const changed of [{ ...space, dimensions: 3 }, { ...space, model: 'other' },
      { ...space, promptVersion: 'raw-v1' }, { ...space, id: 'forged' }]) {
      await expect(f.svc.embedPinned(changed, ['hello'])).rejects.toThrow('EMBEDDING_SPACE_CHANGED');
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('rejects destruction during await and does not initialize an unavailable pinned provider', async () => {
    const f = service();
    expect(() => f.svc.captureSpace()).toThrow('EMBEDDING_SPACE_UNAVAILABLE');
    await f.svc.reloadFromCredential();
    let resolve!: (value: unknown) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise(done => { resolve = done; })));
    const pending = f.svc.embedPinned(f.svc.captureSpace(), ['hello']);
    await vi.waitFor(() => expect(resolve).toBeTypeOf('function'));
    await f.svc.onModuleDestroy();
    resolve({ ok: true, json: async () => ({ embeddings: [[1, 2]] }) });
    await expect(pending).rejects.toThrow('EMBEDDING_SPACE_CHANGED');
  });
  it('returns an empty batch without provider traffic and preserves non-Gemma2 input', async () => {
    const f = service('nomic-embed-text'); await f.svc.reloadFromCredential();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ embeddings: [[1, 2]] }) });
    vi.stubGlobal('fetch', fetchMock);
    expect(await f.svc.embedPinned(f.svc.captureSpace(), [])).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
    await f.svc.embedPinned(f.svc.captureSpace(), ['hello'], 'code_query');
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body).input).toEqual(['hello']);
  });
});
