import { afterEach, describe, expect, it, vi } from 'vitest';
import { DecisionOllamaModelsService } from './decision-ollama-models.service';
import { DecisionOllamaInstallService } from './decision-ollama-install.service';

const tag = 'qwen3.5:2b-q4_K_M';
const digest = 'a'.repeat(64);
afterEach(() => vi.useRealTimers());
function installedFetch() {
  return vi.fn<typeof fetch>(async input => {
    const url = String(input);
    if (url.endsWith('/api/tags')) return Response.json({ models: [{ name: tag, model: tag, size: 1945781358, digest }] });
    if (url.endsWith('/api/show')) return Response.json({ capabilities: ['completion', 'thinking'], template: '{{ .Messages }}' });
    throw new Error('Unexpected pull');
  });
}
describe('Ollama model manager - installed real contract fixtures', () => {
  it('reads chat metadata and never pulls/configures/infers on catalogue or installed install', async () => {
    const fetcher = installedFetch(); const models = new DecisionOllamaModelsService(fetcher);
    const installs = new DecisionOllamaInstallService(models);
    const catalogue = await installs.catalog();
    expect(catalogue.version).toBe(1); expect(catalogue.activeJob).toBeNull();
    expect(catalogue.models).toHaveLength(1);
    expect(catalogue.models[0]).toMatchObject({ modelTag: tag, installed: true, chatCompatible: true,
      readiness: 'metadata_ready', sizeBytes: 1945781358, expectedSizeBytes: 1945781358, digest, installable: false });
    const first = await installs.install({ modelTag: tag, requestId: 'explicit-install-1' });
    expect(first.status).toBe(200); expect(first.body.outcome).toBe('already_installed');
    expect(first.body.job.state).toBe('installed');
    const replay = await installs.install({ modelTag: tag, requestId: 'explicit-install-1' });
    expect(replay.body.outcome).toBe('existing_job'); expect(replay.body.job.jobId).toBe(first.body.job.jobId);
    expect(fetcher.mock.calls.every(([url]) => !String(url).endsWith('/api/pull'))).toBe(true);
    expect((await installs.catalog()).recentJobs[0]?.requestId).toBe('explicit-install-1');
    expect(installs.job(first.body.job.jobId)).toEqual({ job: first.body.job });
  });
  it('does not treat an embedding-only model as chat-ready or pull over an installed model', async () => {
    const fetcher = installedFetch(); fetcher.mockImplementation(async input => String(input).endsWith('/api/tags')
      ? Response.json({ models: [{ name: tag, size: 1945781358, digest }] })
      : Response.json({ capabilities: ['embedding'], template: '' }));
    const installs = new DecisionOllamaInstallService(new DecisionOllamaModelsService(fetcher));
    expect((await installs.catalog()).models[0]).toMatchObject({ installed: true, chatCompatible: false,
      readiness: 'incompatible', installable: false });
    await expect(installs.install({ modelTag: tag, requestId: 'incompatible' })).rejects.toMatchObject({ code: 'OLLAMA_MODEL_INCOMPATIBLE' });
    expect(fetcher.mock.calls.some(([url]) => String(url).endsWith('/api/pull'))).toBe(false);
  });
  it('rejects noncurated tags/URLs/extra fields before network access', async () => {
    const fetcher = installedFetch(); const installs = new DecisionOllamaInstallService(new DecisionOllamaModelsService(fetcher));
    for (const input of [{ modelTag: 'other:latest', requestId: 'x' }, { modelTag: tag, requestId: '' },
      { modelTag: tag, requestId: 'x', endpoint: 'https://example.invalid' }, { modelTag: tag, requestId: '../x' }])
      await expect(installs.install(input)).rejects.toMatchObject({ code: 'OLLAMA_INVALID_REQUEST' });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([
    { models: [{ name: tag, size: 1.5, digest }] },
    { models: [{ name: tag, size: 2 ** 32, digest }] },
    { models: [{ name: tag, model: 'another:tag', size: 1, digest }] },
    { models: [{ name: tag, size: 1, digest: 'unknown' }] },
    { models: [{ name: tag, size: 1, digest }, { name: tag, size: 1, digest }] },
    { models: null },
  ])('does not turn malformed or ambiguous inventory into install permission %j', async inventory => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json(inventory));
    const manager = new DecisionOllamaInstallService(new DecisionOllamaModelsService(fetcher));
    expect((await manager.catalog()).models[0]).toMatchObject({ readiness: 'unknown', installable: false });
    await expect(manager.install({ modelTag: tag, requestId: 'invalid-inventory' })).rejects.toMatchObject({ code: 'OLLAMA_METADATA_UNAVAILABLE' });
    expect(fetcher.mock.calls.every(([url]) => String(url).endsWith('/api/tags'))).toBe(true);
  });
  it.each([{ template: '{{ .Messages }}' }, { capabilities: ['completion'] },
    { capabilities: ['completion'], template: '' }, { capabilities: ['completion', 'PRIVATE INVALID CAP'], template: 'x' }])('keeps installed metadata unknown rather than asserting inference readiness %j', async metadata => {
    const fetcher = installedFetch(); fetcher.mockImplementation(async input => String(input).endsWith('/api/tags')
      ? Response.json({ models: [{ name: tag, size: 1945781358, digest }] }) : Response.json(metadata));
    const manager = new DecisionOllamaInstallService(new DecisionOllamaModelsService(fetcher));
    expect((await manager.catalog()).models[0]).toMatchObject({ installed: true, chatCompatible: null, readiness: 'unknown' });
    await expect(manager.install({ modelTag: tag, requestId: 'unknown-metadata' })).rejects.toMatchObject({ code: 'OLLAMA_METADATA_UNAVAILABLE' });
    expect(fetcher.mock.calls.some(([url]) => String(url).endsWith('/api/pull'))).toBe(false);
  });
  it('bounds JSON metadata and redacts upstream errors', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response('PRIVATE_UPSTREAM'.repeat(100000)));
    const result = await new DecisionOllamaModelsService(fetcher).inspect();
    expect(result.backendAvailable).toBe(false); expect(result.model.installable).toBe(false);
    expect(JSON.stringify(result)).not.toContain('PRIVATE_UPSTREAM');
  });
  it('uses fixed loopback and rejects redirects without following a remote Location', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(null, { status: 302, headers: { Location: 'https://evil.invalid' } }));
    expect((await new DecisionOllamaModelsService(fetcher).inspect()).backendAvailable).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]).toMatchObject(['http://127.0.0.1:11434/api/tags', { redirect: 'error' }]);
  });
  it('bounds metadata header latency and does not publish a late response as ready', async () => {
    vi.useFakeTimers(); let resolve!: (value: Response) => void;
    const pending = new Promise<Response>(yes => { resolve = yes; });
    const models = new DecisionOllamaModelsService(vi.fn<typeof fetch>(() => pending));
    const inspecting = models.inspect(); await vi.advanceTimersByTimeAsync(5001);
    expect((await inspecting).backendAvailable).toBe(false);
    resolve(Response.json({ models: [] })); await Promise.resolve();
  });
  it('module teardown aborts metadata HTTP, clears deadlines, and prevents subsequent fetches', async () => {
    vi.useFakeTimers(); let resolve!: (value: Response) => void;
    const fetcher = vi.fn<typeof fetch>(() => new Promise<Response>(yes => { resolve = yes; }));
    const models = new DecisionOllamaModelsService(fetcher);
    const pending = models.inspect(); expect(vi.getTimerCount()).toBe(1);
    models.onModuleDestroy();
    expect((await pending).backendAvailable).toBe(false); expect(vi.getTimerCount()).toBe(0);
    expect(fetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    expect((await models.inspect()).backendAvailable).toBe(false);
    await expect(models.openPull(new AbortController().signal)).rejects.toMatchObject({ code: 'OLLAMA_UNAVAILABLE' });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const cancelled = vi.fn(); resolve(new Response(new ReadableStream({ cancel: cancelled })));
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(cancelled).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
  });
});
