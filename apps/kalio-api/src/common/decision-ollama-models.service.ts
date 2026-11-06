import { Inject, Injectable, Optional, type OnModuleDestroy } from '@nestjs/common';
import { boundedRead, defaultModel, isRecord, modelError, OLLAMA_MAX_MODEL_BYTES, OLLAMA_MODEL_TAG, OLLAMA_ORIGIN,
  OllamaModelError, type JobError, type ModelRow } from './decision-ollama-models.types';

export const DECISION_OLLAMA_FETCH = 'DECISION_OLLAMA_FETCH';
@Injectable()
export class DecisionOllamaModelsService implements OnModuleDestroy {
  private readonly pending = new Map<AbortSignal, Set<Promise<unknown>>>();
  private readonly uncertain = new WeakSet<AbortSignal>();
  private readonly shutdown = new AbortController();
  constructor(@Optional() @Inject(DECISION_OLLAMA_FETCH) private readonly fetcher: typeof fetch = fetch) {}
  onModuleDestroy(): void { this.shutdown.abort(); }

  async drain(signal: AbortSignal): Promise<void> {
    while (this.pending.get(signal)?.size) await Promise.allSettled([...this.pending.get(signal)!]);
    if (this.uncertain.has(signal)) throw new OllamaModelError('OLLAMA_CANCEL_UNCERTAIN');
  }
  private cleanup(operation: Promise<void>, parent?: AbortSignal): Promise<void> {
    return this.track(operation.catch(error => { if (parent) this.uncertain.add(parent); throw error; }), parent);
  }
  private track<T>(operation: Promise<T>, parent?: AbortSignal): Promise<T> {
    if (!parent) return operation;
    const pending = this.pending.get(parent) ?? new Set<Promise<unknown>>();
    this.pending.set(parent, pending); pending.add(operation);
    const remove = () => { pending.delete(operation); if (!pending.size) this.pending.delete(parent); };
    operation.then(remove, remove); return operation;
  }
  private request(url: string, init: RequestInit, parent?: AbortSignal): Promise<Response> {
    return this.track((async () => {
      const response = await this.fetcher(url, init);
      if (init.signal?.aborted) {
        if (response.body) await this.cleanup(response.body.cancel(), parent);
        throw new OllamaModelError('OLLAMA_UNAVAILABLE');
      }
      return response;
    })(), parent);
  }

  async inspect(signal?: AbortSignal): Promise<{ backendAvailable: boolean; backendError: JobError | null; model: ModelRow }> {
    const model = defaultModel();
    let inventory: unknown;
    try { inventory = await this.json('/api/tags', undefined, signal); }
    catch { signal?.throwIfAborted(); return { backendAvailable: false, backendError: modelError('OLLAMA_UNAVAILABLE'), model }; }
    if (!isRecord(inventory) || !Array.isArray(inventory.models) || inventory.models.length > 128)
      return { backendAvailable: false, backendError: modelError('OLLAMA_METADATA_UNAVAILABLE'), model };
    const matches = inventory.models.filter(item => isRecord(item) && (item.name === OLLAMA_MODEL_TAG || item.model === OLLAMA_MODEL_TAG));
    if (!matches.length) return { backendAvailable: true, backendError: null,
      model: { ...model, readiness: 'not_installed', installable: true } };
    const installed: unknown = matches[0];
    if (matches.length !== 1 || !isRecord(installed) || !Number.isSafeInteger(installed.size)
      || typeof installed.size !== 'number' || installed.size < 0 || installed.size > OLLAMA_MAX_MODEL_BYTES || typeof installed.digest !== 'string'
      || !/^(?:sha256:)?[a-f0-9]{64}$/i.test(installed.digest)
      || installed.name !== undefined && installed.name !== OLLAMA_MODEL_TAG
      || installed.model !== undefined && installed.model !== OLLAMA_MODEL_TAG)
      return { backendAvailable: false, backendError: modelError('OLLAMA_METADATA_UNAVAILABLE'), model };
    model.installed = true; model.sizeBytes = installed.size; model.digest = installed.digest;
    try {
      const metadata: unknown = await this.json('/api/show', { model: OLLAMA_MODEL_TAG }, signal);
      if (!isRecord(metadata) || !Array.isArray(metadata.capabilities) || metadata.capabilities.length > 32
        || !metadata.capabilities.every(item => typeof item === 'string' && /^[a-z][a-z0-9_-]{0,31}$/.test(item)))
        throw new OllamaModelError('OLLAMA_METADATA_UNAVAILABLE');
      model.capabilities = [...metadata.capabilities] as string[];
      if (!model.capabilities.includes('completion')) {
        model.chatCompatible = false; model.readiness = 'incompatible';
      } else if (typeof metadata.template === 'string' && metadata.template.trim()) {
        model.chatCompatible = true; model.readiness = 'metadata_ready';
      } else throw new OllamaModelError('OLLAMA_METADATA_UNAVAILABLE');
      return { backendAvailable: true, backendError: null, model };
    } catch {
      signal?.throwIfAborted();
      return { backendAvailable: true, backendError: modelError('OLLAMA_METADATA_UNAVAILABLE'), model };
    }
  }

  async openPull(signal: AbortSignal): Promise<Response> {
    if (this.shutdown.signal.aborted) throw new OllamaModelError('OLLAMA_UNAVAILABLE');
    const header = new AbortController(); const deadline = setTimeout(() => header.abort(), 5000);
    const combined = AbortSignal.any([header.signal, signal, this.shutdown.signal]);
    try {
      return await boundedRead(this.request(`${OLLAMA_ORIGIN}/api/pull`, {
        method: 'POST', redirect: 'error', cache: 'no-store', signal: combined,
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: OLLAMA_MODEL_TAG, stream: true }),
      }, signal), combined);
    } finally { clearTimeout(deadline); }
  }

  private async json(path: '/api/tags' | '/api/show', body?: { model: string }, parent?: AbortSignal): Promise<unknown> {
    if (this.shutdown.signal.aborted) throw new OllamaModelError('OLLAMA_UNAVAILABLE');
    const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 5000);
    const signal = AbortSignal.any([...(parent ? [parent] : []), controller.signal, this.shutdown.signal]);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const response = await boundedRead(this.request(OLLAMA_ORIGIN + path, {
        method: body ? 'POST' : 'GET', redirect: 'error', cache: 'no-store', signal,
        ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
      }, parent), signal);
      if (!response.ok || !response.body) {
        if (response.body) void this.cleanup(response.body.cancel(), parent).catch(() => undefined);
        throw new OllamaModelError('OLLAMA_UNAVAILABLE');
      }
      reader = response.body.getReader(); let bytes = 0; let text = '';
      const decoder = new TextDecoder('utf-8', { fatal: true });
      for (;;) {
        const chunk = await boundedRead(this.track(reader.read(), parent), signal);
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > 1024 * 1024) throw new OllamaModelError('OLLAMA_SIZE_LIMIT');
        text += decoder.decode(chunk.value, { stream: true });
      }
      return JSON.parse(text + decoder.decode()) as unknown;
    } finally {
      clearTimeout(timeout); controller.abort();
      if (reader) {
        // Abort native fetch first; cleanup never blocks the bounded metadata request.
        void this.cleanup(reader.cancel(), parent).catch(() => undefined);
      }
    }
  }
}
