import { afterEach, describe, expect, it, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { DecisionOllamaModelsService } from './decision-ollama-models.service';
import { DecisionOllamaInstallService } from './decision-ollama-install.service';
import { OLLAMA_MAX_MODEL_BYTES, OLLAMA_MODEL_TAG as tag } from './decision-ollama-models.types';

const digest = 'a'.repeat(64);
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
const tick = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
function fixture() {
  let installed = false;
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const drain = deferred<void>(); let slowDrain = false;
  const cancel = vi.fn(() => slowDrain ? drain.promise : Promise.resolve());
  const stream = new ReadableStream<Uint8Array>({ start(value) { controller = value; }, cancel });
  const fetcher = vi.fn<typeof fetch>(async input => {
    const url = String(input);
    if (url.endsWith('/api/tags')) return Response.json({ models: installed ? [{ name: tag, size: 1945781358, digest }] : [] });
    if (url.endsWith('/api/show')) return Response.json({ capabilities: ['completion'], template: '{{ .Messages }}' });
    if (url.endsWith('/api/pull')) return new Response(stream);
    throw new Error('Unexpected endpoint');
  });
  const models = new DecisionOllamaModelsService(fetcher);
  const service = new DecisionOllamaInstallService(models);
  return { service, models, fetcher, cancel, drain, slow: () => { slowDrain = true; }, installed: () => { installed = true; },
    line: (value: unknown) => controller.enqueue(new TextEncoder().encode(JSON.stringify(value) + '\n')),
    raw: (value: Uint8Array) => controller.enqueue(value), end: () => controller.close() };
}
afterEach(() => vi.useRealTimers());
describe('managed Ollama pull using fake streaming HTTP responses', () => {
  it('reserves before awaits, deduplicates a key, rejects concurrent keys, restores via catalog', async () => {
    const f = fixture(); const first = f.service.install({ modelTag: tag, requestId: 'same' });
    const replay = await f.service.install({ modelTag: tag, requestId: 'same' });
    expect(replay.body.job.state).toBe('checking');
    await expect(f.service.install({ modelTag: tag, requestId: 'other' })).rejects.toMatchObject({ code: 'OLLAMA_INSTALL_BUSY' });
    const started = await first; await tick();
    expect(started.status).toBe(202); expect(started.body.job.jobId).toBe(replay.body.job.jobId);
    expect((await f.service.catalog()).activeJob?.jobId).toBe(started.body.job.jobId);
    expect(f.fetcher.mock.calls.filter(([url]) => String(url).endsWith('/api/pull'))).toHaveLength(1);
    f.service.cancel(started.body.job.jobId, {}); await tick();
  });
  it('tracks unique digests, permits newer regressing counts and verifies fresh metadata before installed', async () => {
    const f = fixture(); const { body } = await f.service.install({ modelTag: tag, requestId: 'progress' }); await tick();
    f.line({ status: 'pulling aaaaaaaaaaaa', digest: `sha256:${digest}`, total: 100, completed: 90 }); await tick();
    const first = f.service.job(body.job.jobId).job;
    f.line({ status: 'pulling aaaaaaaaaaaa', digest, total: 100, completed: 40 }); await tick();
    const next = f.service.job(body.job.jobId).job;
    expect(next.revision).toBeGreaterThan(first.revision);
    expect(next.progress).toMatchObject({ completedBytes: 40, observedTotalBytes: 100 });
    f.line({ status: 'pulling bbbbbbbbbbbb', digest: 'b'.repeat(64), total: 50 }); await tick();
    expect(f.service.job(body.job.jobId).job.progress).toMatchObject({ completedBytes: 40, observedTotalBytes: 150,
      currentBlob: { completedBytes: null, totalBytes: 50 } });
    f.installed(); f.line({ status: 'success' }); f.end(); await tick();
    expect(f.service.job(body.job.jobId).job.state).toBe('installed');
    expect((await f.service.catalog()).activeJob).toBeNull();
    expect(f.fetcher.mock.calls.every(([url, init]) => String(url).startsWith('http://127.0.0.1:11434/api/') && init?.redirect === 'error')).toBe(true);
    expect(f.fetcher.mock.calls.find(([url]) => String(url).endsWith('/api/pull'))?.[1]?.body)
      .toBe(JSON.stringify({ model: tag, stream: true }));
  });
  it('cancel increments revision and holds the slot until own stream drain; shared transfer is not killed', async () => {
    const f = fixture(); f.slow(); const { body } = await f.service.install({ modelTag: tag, requestId: 'cancel' }); await tick();
    const result = f.service.cancel(body.job.jobId, {});
    expect(result.status).toBe(202); expect(result.body.job.state).toBe('cancel_requested');
    expect(result.body.job.revision).toBeGreaterThan(body.job.revision); await tick();
    expect(f.cancel).toHaveBeenCalledTimes(1);
    expect(f.service.job(body.job.jobId).job.state).toBe('cancel_requested');
    await expect(f.service.install({ modelTag: tag, requestId: 'blocked' })).rejects.toMatchObject({ code: 'OLLAMA_INSTALL_BUSY' });
    f.drain.resolve(); await tick();
    const done = f.service.cancel(body.job.jobId, {});
    expect(done.status).toBe(200); expect(done.body.job.state).toBe('cancelled');
    expect(done.body.job.revision).toBeGreaterThan(result.body.job.revision);
    expect(done.body.job.cancelScope).toBe('request_only');
    expect(f.fetcher.mock.calls.some(([url]) => /delete|stop|kill/.test(String(url)))).toBe(false);
  });
  it('reports unknown after uncertain drain and still rejects a second pull', async () => {
    vi.useFakeTimers(); const f = fixture(); f.slow();
    const { body } = await f.service.install({ modelTag: tag, requestId: 'uncertain' }); await tick();
    f.service.cancel(body.job.jobId, {}); await tick(); await vi.advanceTimersByTimeAsync(5001);
    expect(f.service.job(body.job.jobId).job).toMatchObject({ state: 'unknown', error: { code: 'OLLAMA_CANCEL_UNCERTAIN' } });
    await expect(f.service.install({ modelTag: tag, requestId: 'no-rerun' })).rejects.toMatchObject({ code: 'OLLAMA_INSTALL_BUSY' });
    f.drain.resolve(); await tick();
    expect(f.service.job(body.job.jobId).job.state).toBe('cancelled');
  });
  it('bounds a cancelled preflight response while retaining the late upstream slot until drain', async () => {
    vi.useFakeTimers(); const late = deferred<Response>(); const cancelled = vi.fn();
    const fetcher = vi.fn<typeof fetch>(() => late.promise);
    const manager = new DecisionOllamaInstallService(new DecisionOllamaModelsService(fetcher));
    const first = manager.install({ modelTag: tag, requestId: 'late-preflight' });
    const replay = await manager.install({ modelTag: tag, requestId: 'late-preflight' });
    manager.cancel(replay.body.job.jobId, {}); await tick(); await vi.advanceTimersByTimeAsync(5001);
    expect((await first).body.job.state).toBe('unknown');
    await expect(manager.install({ modelTag: tag, requestId: 'late-duplicate' })).rejects.toMatchObject({ code: 'OLLAMA_INSTALL_BUSY' });
    late.resolve(new Response(new ReadableStream({ cancel: cancelled }))); await tick();
    expect(cancelled).toHaveBeenCalledTimes(1);
    expect(manager.job(replay.body.job.jobId).job.state).toBe('cancelled');
  });
  it('treats failed stream cancellation as unknown, never proven cancelled or a free launch slot', async () => {
    const f = fixture(); f.cancel.mockRejectedValueOnce(new Error('PRIVATE_CANCEL_ERROR'));
    const { body } = await f.service.install({ modelTag: tag, requestId: 'failed-drain' }); await tick();
    f.service.cancel(body.job.jobId, {}); await tick();
    expect(f.service.job(body.job.jobId).job).toMatchObject({ state: 'unknown', error: { code: 'OLLAMA_CANCEL_UNCERTAIN' } });
    await expect(f.service.install({ modelTag: tag, requestId: 'still-blocked' })).rejects.toMatchObject({ code: 'OLLAMA_INSTALL_BUSY' });
    expect(JSON.stringify(f.service.job(body.job.jobId))).not.toContain('PRIVATE_CANCEL_ERROR');
  });
  it('bounds 128 unique digest records and cumulative response bytes', async () => {
    const digests = fixture(); const first = await digests.service.install({ modelTag: tag, requestId: 'digests' }); await tick();
    for (let i = 0; i < 129; i++) {
      digests.line({ status: 'pulling aaaaaaaaaaaa', digest: i.toString(16).padStart(64, '0'), total: 1 }); await tick();
    }
    await tick();
    expect(digests.service.job(first.body.job.jobId).job.state).toBe('failed');
    const wire = fixture(); const second = await wire.service.install({ modelTag: tag, requestId: 'wire' }); await tick();
    const frame = new TextEncoder().encode(JSON.stringify({ status: 'pulling manifest', padding: 'x'.repeat(65000) }) + '\n');
    for (let i = 0; i < 1034; i++) wire.raw(frame);
    for (let i = 0; i < 1100; i++) await tick();
    expect(wire.service.job(second.body.job.jobId).job).toMatchObject({ state: 'failed', error: { code: 'OLLAMA_SIZE_LIMIT' } });
  });
  it.each([
    { status: 'pulling aaaaaaaaaaaa', digest, total: 100, completed: 101 },
    { status: 'pulling aaaaaaaaaaaa', digest, total: 1.5 },
    { status: 'pulling aaaaaaaaaaaa', digest: 'https://evil.invalid', total: 100 },
    { status: 'pulling manifest', completed: 1 },
    { status: 'arbitrary private detail' },
    { error: 'PRIVATE_UPSTREAM_SENTINEL' },
  ])('fails closed on malformed progress %j', async value => {
    const f = fixture(); const { body } = await f.service.install({ modelTag: tag, requestId: 'malformed' }); await tick();
    f.line(value); await tick();
    const job = f.service.job(body.job.jobId).job;
    expect(job.state).toBe('failed'); expect(JSON.stringify(job)).not.toContain('PRIVATE_UPSTREAM_SENTINEL');
  });
  it('rejects observed model budget overflow without double-counting repeated digests', async () => {
    const f = fixture(); const { body } = await f.service.install({ modelTag: tag, requestId: 'size' }); await tick();
    f.line({ status: 'pulling aaaaaaaaaaaa', digest, total: OLLAMA_MAX_MODEL_BYTES, completed: 0 }); await tick();
    f.line({ status: 'pulling bbbbbbbbbbbb', digest: 'b'.repeat(64), total: 1 }); await tick();
    expect(f.service.job(body.job.jobId).job).toMatchObject({ state: 'failed', error: { code: 'OLLAMA_SIZE_LIMIT' } });
  });
  it('rejects changed digest totals', async () => {
    const f = fixture(); const { body } = await f.service.install({ modelTag: tag, requestId: 'change' }); await tick();
    f.line({ status: 'pulling aaaaaaaaaaaa', digest, total: 100 }); await tick();
    f.line({ status: 'pulling aaaaaaaaaaaa', digest, total: 101 }); await tick();
    expect(f.service.job(body.job.jobId).job.state).toBe('failed');
  });
  it.each([new Uint8Array(65537).fill(120), new Uint8Array([255, 254])])('bounds frames and rejects invalid UTF8', async bytes => {
    const f = fixture(); const { body } = await f.service.install({ modelTag: tag, requestId: 'bytes' }); await tick();
    f.raw(bytes); await tick(); expect(f.service.job(body.job.jobId).job.state).toBe('failed');
  });
  it('EOF without success fails and success without fresh metadata is not installed', async () => {
    for (const success of [false, true]) {
      const f = fixture(); const { body } = await f.service.install({ modelTag: tag, requestId: 'eof' }); await tick();
      if (success) f.line({ status: 'success' }); f.end(); await tick();
      expect(f.service.job(body.job.jobId).job.state).toBe('failed');
    }
  });
  it('times out an idle stream and releases only after drain', async () => {
    vi.useFakeTimers(); const f = fixture(); const { body } = await f.service.install({ modelTag: tag, requestId: 'idle' });
    await tick(); await vi.advanceTimersByTimeAsync(60001); await tick();
    expect(f.service.job(body.job.jobId).job).toMatchObject({ state: 'failed', error: { code: 'OLLAMA_PULL_TIMEOUT' } });
  });
  it('enforces the four-hour lifetime even when heartbeats keep the stream non-idle', async () => {
    vi.useFakeTimers(); const f = fixture(); const { body } = await f.service.install({ modelTag: tag, requestId: 'lifetime' });
    await tick();
    for (let i = 0; i < 479; i++) {
      await vi.advanceTimersByTimeAsync(30000); f.line({ status: 'pulling manifest' }); await tick();
    }
    expect(f.service.job(body.job.jobId).job.state).toBe('pulling');
    await vi.advanceTimersByTimeAsync(30001); await tick();
    expect(f.service.job(body.job.jobId).job).toMatchObject({ state: 'failed', error: { code: 'OLLAMA_PULL_TIMEOUT' } });
  });
  it('bounds late pull headers and cancels the late response body before freeing its slot', async () => {
    vi.useFakeTimers(); const late = deferred<Response>(); const cancelled = vi.fn();
    const fetcher = vi.fn<typeof fetch>(input => String(input).endsWith('/api/tags')
      ? Promise.resolve(Response.json({ models: [] })) : late.promise);
    const manager = new DecisionOllamaInstallService(new DecisionOllamaModelsService(fetcher));
    const { body } = await manager.install({ modelTag: tag, requestId: 'late-headers' }); await tick();
    await vi.advanceTimersByTimeAsync(10001);
    expect(manager.job(body.job.jobId).job.state).toBe('unknown');
    await expect(manager.install({ modelTag: tag, requestId: 'no-duplicate' })).rejects.toMatchObject({ code: 'OLLAMA_INSTALL_BUSY' });
    late.resolve(new Response(new ReadableStream({ cancel: cancelled }))); await tick();
    expect(cancelled).toHaveBeenCalledTimes(1); expect(manager.job(body.job.jobId).job.state).toBe('failed');
  });
  it('drains non-OK pull response bodies too, without exposing raw upstream error content', async () => {
    const drain = deferred<void>(); const cancelled = vi.fn(() => drain.promise);
    const fetcher = vi.fn<typeof fetch>(async input => String(input).endsWith('/api/tags')
      ? Response.json({ models: [] }) : new Response(new ReadableStream({ cancel: cancelled }), { status: 500 }));
    const manager = new DecisionOllamaInstallService(new DecisionOllamaModelsService(fetcher));
    const { body } = await manager.install({ modelTag: tag, requestId: 'server-error' }); await tick();
    expect(cancelled).toHaveBeenCalledTimes(1);
    await expect(manager.install({ modelTag: tag, requestId: 'still-draining' })).rejects.toMatchObject({ code: 'OLLAMA_INSTALL_BUSY' });
    drain.resolve(); await tick();
    expect(manager.job(body.job.jobId).job).toMatchObject({ state: 'failed', error: { code: 'OLLAMA_PULL_FAILED' } });
  });
  it('graceful shutdown aborts only owned HTTP, clears timers, rejects new work and never invents completion', async () => {
    vi.useFakeTimers(); const f = fixture(); const { body } = await f.service.install({ modelTag: tag, requestId: 'shutdown' }); await tick();
    const signal = f.fetcher.mock.calls.find(([url]) => String(url).endsWith('/api/pull'))?.[1]?.signal;
    expect(signal?.aborted).toBe(false); expect(vi.getTimerCount()).toBe(2);
    await f.service.onModuleDestroy();
    expect(signal?.aborted).toBe(true); expect(f.cancel).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
    expect(f.service.job(body.job.jobId).job.state).toBe('unknown');
    const calls = f.fetcher.mock.calls.length;
    await expect(f.service.install({ modelTag: tag, requestId: 'after-shutdown' })).rejects.toMatchObject({ code: 'OLLAMA_UNAVAILABLE' });
    await expect(f.service.catalog()).rejects.toMatchObject({ code: 'OLLAMA_UNAVAILABLE' });
    expect(f.service.cancel(body.job.jobId, {}).body.job.state).toBe('unknown');
    expect(f.fetcher).toHaveBeenCalledTimes(calls);
  });
  it('shutdown is idempotent and bounded to five seconds even when the owned stream never drains', async () => {
    vi.useFakeTimers(); const f = fixture(); f.slow();
    const { body } = await f.service.install({ modelTag: tag, requestId: 'shutdown-uncertain' }); await tick();
    const stopping = f.service.onModuleDestroy(); expect(f.service.onModuleDestroy()).toBe(stopping);
    let stopped = false; void stopping.then(() => { stopped = true; });
    await vi.advanceTimersByTimeAsync(4999); expect(stopped).toBe(false);
    await vi.advanceTimersByTimeAsync(1); await stopping;
    expect(stopped).toBe(true); expect(vi.getTimerCount()).toBe(0);
    expect(f.service.job(body.job.jobId).job.state).toBe('unknown');
    f.drain.resolve(); await tick();
    expect(f.service.job(body.job.jobId).job.state).toBe('unknown'); expect(vi.getTimerCount()).toBe(0);
  });
  it('shutdown clears already-pending uncertainty timers without resurrecting idle/lifetime timers', async () => {
    vi.useFakeTimers(); const f = fixture(); f.slow();
    const { body } = await f.service.install({ modelTag: tag, requestId: 'shutdown-cancel' }); await tick();
    f.service.cancel(body.job.jobId, {}); await tick(); expect(vi.getTimerCount()).toBe(1);
    const stopping = f.service.onModuleDestroy(); await vi.advanceTimersByTimeAsync(5000); await stopping;
    expect(vi.getTimerCount()).toBe(0); expect(f.service.job(body.job.jobId).job.state).toBe('unknown');
    f.drain.resolve(); await tick(); expect(vi.getTimerCount()).toBe(0);
  });
  it('shutdown before any install is immediate and permanently prevents outbound traffic', async () => {
    const f = fixture(); await f.service.onModuleDestroy();
    await expect(f.service.install({ modelTag: tag, requestId: 'never-start' })).rejects.toMatchObject({ code: 'OLLAMA_UNAVAILABLE' });
    expect(f.fetcher).not.toHaveBeenCalled();
  });
  it('Nest context close actually invokes both owned lifecycle hooks without an HTTP listener', async () => {
    vi.useFakeTimers(); const f = fixture();
    const module = await Test.createTestingModule({ providers: [
      { provide: DecisionOllamaModelsService, useValue: f.models },
      { provide: DecisionOllamaInstallService, useValue: f.service },
    ] }).compile();
    const { body } = await f.service.install({ modelTag: tag, requestId: 'nest-close' }); await tick();
    await module.close();
    expect(f.cancel).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
    expect(f.service.job(body.job.jobId).job.state).toBe('unknown');
    const calls = f.fetcher.mock.calls.length;
    expect((await f.models.inspect()).backendAvailable).toBe(false);
    expect(f.fetcher).toHaveBeenCalledTimes(calls);
  });
  it('does not invent a recovered job after service restart', async () => {
    const f = fixture(); const { body } = await f.service.install({ modelTag: tag, requestId: 'before-restart' }); await tick();
    const restarted = new DecisionOllamaInstallService(new DecisionOllamaModelsService(f.fetcher));
    expect(() => restarted.job(body.job.jobId)).toThrowError(expect.objectContaining({ code: 'OLLAMA_JOB_NOT_FOUND' }));
    expect((await restarted.catalog()).activeJob).toBeNull();
    f.service.cancel(body.job.jobId, {}); await tick();
  });
  it('retains bounded request tombstones and rejects new keys when the ledger is full', async () => {
    const f = fixture(); f.installed(); let oldest = '';
    for (let i = 0; i < 256; i++) {
      const result = await f.service.install({ modelTag: tag, requestId: `key-${i}` }); if (!i) oldest = result.body.job.jobId;
    }
    expect((await f.service.catalog()).recentJobs).toHaveLength(16);
    expect(() => f.service.job(oldest)).toThrow();
    await expect(f.service.install({ modelTag: tag, requestId: 'key-0' })).rejects.toMatchObject({ code: 'OLLAMA_REQUEST_EXPIRED' });
    await expect(f.service.install({ modelTag: tag, requestId: 'new-key' })).rejects.toMatchObject({ code: 'OLLAMA_REQUEST_HISTORY_FULL' });
    expect(f.fetcher.mock.calls.some(([url]) => String(url).endsWith('/api/pull'))).toBe(false);
  });
});
