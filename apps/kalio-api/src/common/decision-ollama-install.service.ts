import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DecisionOllamaModelsService } from './decision-ollama-models.service';
import { boundedRead, defaultModel, isRecord, modelError, OLLAMA_JOB_ID, OLLAMA_MAX_MODEL_BYTES,
  OLLAMA_MODEL_TAG, OllamaModelError, type InstallBody, type ModelCatalog, type ModelJob,
  type ModelRow, type Progress } from './decision-ollama-models.types';

interface Managed {
  job: ModelJob; model: ModelRow; controller: AbortController; cancelled: boolean;
  blobs: Map<string, { digest: string; completedBytes: number | null; totalBytes: number }>;
  timers: Set<ReturnType<typeof setTimeout>>; settled: Promise<void>; resolveSettled: () => void;
}
@Injectable()
export class DecisionOllamaInstallService implements OnModuleDestroy {
  private readonly jobs = new Map<string, Managed>();
  // Bounded tombstones prevent an evicted request key from silently launching again.
  private readonly requests = new Map<string, string>();
  private active: Managed | null = null;
  private closing = false;
  private shutdown: Promise<void> | undefined;
  constructor(private readonly models: DecisionOllamaModelsService) {}

  onModuleDestroy(): Promise<void> { return this.shutdown ??= this.stop(); }
  private async stop(): Promise<void> {
    this.closing = true;
    const item = this.active;
    if (!item) return;
    this.change(item, { state: 'unknown', error: modelError('OLLAMA_UNAVAILABLE') });
    for (const timer of item.timers) clearTimeout(timer);
    item.timers.clear(); item.controller.abort();
    let deadline: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([item.settled, new Promise<void>(resolve => { deadline = setTimeout(resolve, 5000); })]);
    } finally {
      clearTimeout(deadline);
      for (const timer of item.timers) clearTimeout(timer);
      item.timers.clear();
    }
  }

  async catalog(): Promise<ModelCatalog> {
    if (this.closing) throw new OllamaModelError('OLLAMA_UNAVAILABLE');
    const inventory = await this.models.inspect();
    return { version: 1, backendAvailable: inventory.backendAvailable, backendError: inventory.backendError,
      models: [inventory.model], activeJob: this.active ? this.view(this.active) : null,
      recentJobs: [...this.jobs.values()].reverse().map(item => this.view(item)) };
  }

  async install(input: unknown): Promise<{ status: 200 | 202; body: InstallBody }> {
    if (this.closing) throw new OllamaModelError('OLLAMA_UNAVAILABLE');
    if (!isRecord(input) || Object.keys(input).length !== 2 || input.modelTag !== OLLAMA_MODEL_TAG
      || typeof input.requestId !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(input.requestId))
      throw new OllamaModelError('OLLAMA_INVALID_REQUEST', 400);
    const previous = this.requests.get(input.requestId);
    if (previous) {
      const item = this.jobs.get(previous);
      if (!item) throw new OllamaModelError('OLLAMA_REQUEST_EXPIRED', 409);
      return this.result(item, 200, 'existing_job');
    }
    if (this.active) throw new OllamaModelError('OLLAMA_INSTALL_BUSY', 409);
    if (this.requests.size >= 256) throw new OllamaModelError('OLLAMA_REQUEST_HISTORY_FULL', 409);
    const now = Date.now();
    let resolveSettled!: () => void;
    const settled = new Promise<void>(resolve => { resolveSettled = resolve; });
    const item: Managed = { job: { jobId: randomUUID(), requestId: input.requestId, modelTag: OLLAMA_MODEL_TAG,
      revision: 0, state: 'checking', progress: { completedBytes: 0, observedTotalBytes: 0, currentBlob: null },
      error: null, cancelScope: 'request_only', createdAt: now, updatedAt: now }, model: defaultModel(),
      controller: new AbortController(), cancelled: false, blobs: new Map(), timers: new Set(), settled, resolveSettled };
    this.active = item; this.jobs.set(item.job.jobId, item); this.requests.set(input.requestId, item.job.jobId);
    if (this.jobs.size > 16) this.jobs.delete(this.jobs.keys().next().value as string);
    try {
      const inventory = await this.models.inspect(item.controller.signal);
      item.controller.signal.throwIfAborted(); item.model = inventory.model;
      if (inventory.backendError) throw new OllamaModelError(inventory.backendError.code);
      if (item.model.installed) {
        if (item.model.readiness !== 'metadata_ready') throw new OllamaModelError('OLLAMA_MODEL_INCOMPATIBLE', 409);
        this.change(item, { state: 'installed' }); this.release(item);
        return this.result(item, 200, 'already_installed');
      }
      this.change(item, { state: 'pulling' });
      void this.pull(item);
      return this.result(item, 202, 'started');
    } catch (error) {
      await this.finish(item, error);
      if (item.cancelled) return this.result(item, 200, 'existing_job');
      throw error instanceof OllamaModelError ? error : new OllamaModelError('OLLAMA_UNAVAILABLE');
    }
  }

  job(id: string): { job: ModelJob } { return { job: this.view(this.lookup(id)) }; }
  cancel(id: string, input: unknown): { status: 200 | 202; body: { job: ModelJob } } {
    if (!isRecord(input) || Object.keys(input).length) throw new OllamaModelError('OLLAMA_INVALID_REQUEST', 400);
    const item = this.lookup(id);
    if (this.closing || this.active !== item) return { status: 200, body: { job: this.view(item) } };
    if (!item.cancelled) {
      item.cancelled = true; this.change(item, { state: 'cancel_requested' }); item.controller.abort();
    }
    return { status: 202, body: { job: this.view(item) } };
  }

  private lookup(id: string): Managed {
    if (!OLLAMA_JOB_ID.test(id)) throw new OllamaModelError('OLLAMA_INVALID_REQUEST', 400);
    const item = this.jobs.get(id);
    if (!item) throw new OllamaModelError('OLLAMA_JOB_NOT_FOUND', 404);
    return item;
  }
  private view(item: Managed): ModelJob { return structuredClone(item.job); }
  private result(item: Managed, status: 200 | 202, outcome: InstallBody['outcome']): { status: 200 | 202; body: InstallBody } {
    return { status, body: { outcome, model: structuredClone(item.model), job: this.view(item) } };
  }
  private change(item: Managed, patch: Partial<Pick<ModelJob, 'state' | 'progress' | 'error'>>): void {
    Object.assign(item.job, patch); item.job.revision++; item.job.updatedAt = Date.now();
  }
  private release(item: Managed): void { if (this.active === item) this.active = null; item.resolveSettled(); }
  private timer(item: Managed, callback: () => void, milliseconds: number): ReturnType<typeof setTimeout> | undefined {
    if (this.closing) return undefined;
    const timer = setTimeout(() => { item.timers.delete(timer); callback(); }, milliseconds);
    item.timers.add(timer); return timer;
  }
  private clearTimer(item: Managed, timer: ReturnType<typeof setTimeout> | undefined): void {
    clearTimeout(timer); if (timer) item.timers.delete(timer);
  }
  private failure(item: Managed, error: unknown): void {
    this.change(item, this.closing ? { state: 'unknown', error: modelError('OLLAMA_UNAVAILABLE') }
      : item.cancelled ? { state: 'cancelled', error: null }
      : { state: 'failed', error: modelError(error instanceof OllamaModelError ? error.code : 'OLLAMA_PULL_FAILED') });
  }
  private async finish(item: Managed, failure?: unknown, reader?: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
    item.controller.abort();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const uncertain = new Promise<void>(resolve => { timer = this.timer(item, () => {
      this.change(item, { state: 'unknown', error: modelError('OLLAMA_CANCEL_UNCERTAIN') }); resolve();
    }, 5000); if (this.closing) resolve(); });
    const drained = (async () => {
      try {
        await Promise.all([reader?.cancel(), this.models.drain(item.controller.signal)]);
        if (failure !== undefined) this.failure(item, failure);
        else this.change(item, this.closing ? { state: 'unknown', error: modelError('OLLAMA_UNAVAILABLE') }
          : { state: 'installed', error: null });
        this.release(item);
      } catch {
        // A failed drain is not proof of cancellation. Retain the exclusive slot fail-closed.
        this.change(item, { state: 'unknown', error: modelError('OLLAMA_CANCEL_UNCERTAIN') });
      } finally { this.clearTimer(item, timer); }
    })();
    // Respond within a bound; the actual cleanup retains ownership even after this race returns.
    await Promise.race([drained, uncertain]);
  }

  private async pull(item: Managed): Promise<void> {
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let idle: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    const expire = () => { timedOut = true; item.controller.abort(); };
    const deadline = this.timer(item, expire, 4 * 60 * 60 * 1000);
    const resetIdle = () => { this.clearTimer(item, idle); idle = this.timer(item, expire, 60000); };
    let failure: unknown;
    try {
      resetIdle();
      const response = await this.models.openPull(item.controller.signal);
      reader = response.body?.getReader();
      if (!response.ok || !reader) throw new OllamaModelError('OLLAMA_PULL_FAILED');
      const decoder = new TextDecoder('utf-8', { fatal: true });
      let pending = ''; let bytes = 0; let success = false;
      const frame = (text: string) => {
        if (Buffer.byteLength(text, 'utf8') > 65536) throw new OllamaModelError('OLLAMA_SIZE_LIMIT');
        if (!text.trim()) return;
        if (success) throw new OllamaModelError('OLLAMA_INVALID_PROGRESS');
        success = this.progress(item, JSON.parse(text) as unknown);
      };
      for (;;) {
        const chunk = await boundedRead(reader.read(), item.controller.signal);
        if (chunk.done) break;
        resetIdle(); bytes += chunk.value.byteLength;
        if (bytes > 64 * 1024 * 1024) throw new OllamaModelError('OLLAMA_SIZE_LIMIT');
        pending += decoder.decode(chunk.value, { stream: true });
        let newline: number;
        while ((newline = pending.indexOf('\n')) >= 0) { frame(pending.slice(0, newline)); pending = pending.slice(newline + 1); }
        if (Buffer.byteLength(pending, 'utf8') > 65536) throw new OllamaModelError('OLLAMA_SIZE_LIMIT');
      }
      pending += decoder.decode(); if (pending) frame(pending);
      if (!success) throw new OllamaModelError('OLLAMA_PULL_FAILED');
      this.change(item, { state: 'verifying' });
      const inventory = await this.models.inspect(item.controller.signal);
      item.controller.signal.throwIfAborted(); item.model = inventory.model;
      if (inventory.backendError || item.model.readiness !== 'metadata_ready') throw new OllamaModelError('OLLAMA_METADATA_UNAVAILABLE');
    } catch (error) { failure = timedOut ? new OllamaModelError('OLLAMA_PULL_TIMEOUT') : error; }
    finally {
      this.clearTimer(item, idle); this.clearTimer(item, deadline);
      await this.finish(item, failure, reader);
    }
  }

  private progress(item: Managed, value: unknown): boolean {
    if (!isRecord(value) || typeof value.status !== 'string' || value.error !== undefined)
      throw new OllamaModelError('OLLAMA_INVALID_PROGRESS');
    if (value.digest !== undefined) {
      if (typeof value.digest !== 'string' || !/^(?:sha256:)?[a-f0-9]{64}$/i.test(value.digest)
        || typeof value.total !== 'number' || !Number.isSafeInteger(value.total) || value.total < 0
        || value.total > OLLAMA_MAX_MODEL_BYTES || value.completed !== undefined &&
        (typeof value.completed !== 'number' || !Number.isSafeInteger(value.completed) || value.completed < 0 || value.completed > value.total))
        throw new OllamaModelError('OLLAMA_INVALID_PROGRESS');
      const digest = value.digest.replace(/^sha256:/i, '').toLowerCase();
      const previous = item.blobs.get(digest);
      if (previous && previous.totalBytes !== value.total || !previous && item.blobs.size >= 128)
        throw new OllamaModelError('OLLAMA_INVALID_PROGRESS');
      const blob = { digest, completedBytes: value.completed === undefined ? null : value.completed as number, totalBytes: value.total };
      item.blobs.set(digest, blob);
      const progress: Progress = { completedBytes: 0, observedTotalBytes: 0, currentBlob: blob };
      for (const entry of item.blobs.values()) { progress.completedBytes += entry.completedBytes ?? 0; progress.observedTotalBytes += entry.totalBytes; }
      if (progress.observedTotalBytes > OLLAMA_MAX_MODEL_BYTES) throw new OllamaModelError('OLLAMA_SIZE_LIMIT');
      this.change(item, { progress });
    } else if (value.total !== undefined || value.completed !== undefined) throw new OllamaModelError('OLLAMA_INVALID_PROGRESS');
    if (value.status === 'success') return true;
    if (!/^(?:pulling manifest|pulling [a-f0-9]{12,64}|verifying sha256 digest|writing manifest|removing any unused layers)$/.test(value.status))
      throw new OllamaModelError('OLLAMA_INVALID_PROGRESS');
    return false;
  }
}
