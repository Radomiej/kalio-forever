import { createDecisionProtectedFetcher } from '../settings/decision-protected-fetch';
import { getApiBaseUrl } from '../../services/apiClient';

export type SpeechScope = { sessionId: string; draftId?: never } | { draftId: string; sessionId?: never };

export function speechScopeKey(scope: SpeechScope): string {
  return scope.sessionId ? `session:${scope.sessionId}` : `draft:${scope.draftId}`;
}

export function getLaunchSpeechScope(): SpeechScope | null {
  try {
    const key = 'kalio.voice.launchDraftId.v1';
    const saved = localStorage.getItem(key);
    const draftId = saved && /^[A-Za-z0-9_-]{1,80}$/.test(saved) ? saved : crypto.randomUUID();
    localStorage.setItem(key, draftId);
    return { draftId };
  } catch { return null; }
}

export function isLocalSpeechPage(): boolean {
  const loopback = ['localhost', '127.0.0.1', '[::1]'];
  if (globalThis.location?.protocol !== 'http:' || !loopback.includes(globalThis.location.hostname)) return false;
  try { return loopback.includes(new URL(getApiBaseUrl(), globalThis.location.origin).hostname); }
  catch { return false; }
}

function parseStatus(value: unknown) {
  if (!value || typeof value !== 'object') throw new Error('Invalid speech status.');
  const v = value as Record<string, unknown>;
  if (!['missing', 'installing', 'verifying', 'ready', 'error'].includes(String(v.status))
    || v.model !== 'parakeet-tdt-v3-int8' || v.backend !== 'sherpa-onnx-cpu'
    || typeof v.installed !== 'boolean' || v.maxDurationSeconds !== 60
    || typeof v.downloadedBytes !== 'number' || !Number.isFinite(v.downloadedBytes) || v.downloadedBytes < 0
    || typeof v.totalBytes !== 'number' || !Number.isFinite(v.totalBytes) || v.totalBytes < 0
    || !['runtime', 'model', null].includes(v.phase as string | null)
    || (v.errorCode !== null && typeof v.errorCode !== 'string')) throw new Error('Invalid speech status.');
  return {
    status: v.status as 'missing' | 'installing' | 'verifying' | 'ready' | 'error',
    installed: v.installed, model: v.model, backend: v.backend,
    downloadedBytes: v.downloadedBytes, totalBytes: v.totalBytes,
    phase: v.phase as 'runtime' | 'model' | null, errorCode: v.errorCode as string | null,
    maxDurationSeconds: 60 as const,
  };
}

export type SpeechStatus = ReturnType<typeof parseStatus>;

export function createSpeechApi(rawFetch: typeof fetch = (...args) => fetch(...args)) {
  const fetcher = createDecisionProtectedFetcher(rawFetch);
  let bootstrap: Promise<void> | undefined;
  async function request(path: string, init: RequestInit = {}) {
    const options: RequestInit = { ...init, credentials: 'same-origin', redirect: 'error', cache: 'no-store' };
    let response = await fetcher(path, options);
    if (response.status === 401) {
      bootstrap ??= fetcher('/api/decision/auth', {
        method: 'POST', credentials: 'same-origin', redirect: 'error', cache: 'no-store',
        headers: { 'Content-Type': 'application/json' }, body: '{}',
      }).then((auth) => { if (auth.status !== 204) throw new Error('Speech authentication unavailable.'); })
        .finally(() => { bootstrap = undefined; });
      await bootstrap;
      if (init.signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
      response = await fetcher(path, options);
    }
    if (!response.ok) throw new Error(`Speech request failed (${response.status}).`);
    return response.json() as Promise<unknown>;
  }
  const put = (path: string) => request(path, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{}',
  });
  return {
    status: async (signal?: AbortSignal) => parseStatus(await request('/api/speech/status', { signal })),
    install: async () => parseStatus(await put('/api/speech/install')),
    cancelInstall: async () => parseStatus(await put('/api/speech/install/cancel')),
    cancel: (id: string) => put(`/api/speech/transcriptions/${encodeURIComponent(id)}/cancel`),
    transcribe: async (id: string, scope: SpeechScope, audio: Blob, signal: AbortSignal) => {
      const hasSession = typeof scope.sessionId === 'string';
      const hasDraft = typeof scope.draftId === 'string';
      const identifier = hasSession ? scope.sessionId : scope.draftId;
      if (hasSession === hasDraft || !identifier || !/^[A-Za-z0-9_-]{1,80}$/.test(identifier)) throw new Error('Invalid speech recording scope.');
      const field = hasSession ? 'sessionId' : 'draftId';
      const other = hasSession ? 'draftId' : 'sessionId';
      const body = new FormData();
      body.append('audio', audio, 'dictation.wav');
      body.append(field, identifier);
      const value = await request(`/api/speech/transcriptions/${encodeURIComponent(id)}`, { method: 'PUT', body, signal });
      if (!value || typeof value !== 'object' || !('requestId' in value) || value.requestId !== id
        || !(field in value) || (value as Record<string, unknown>)[field] !== identifier || other in value
        || !('text' in value) || typeof value.text !== 'string'
        || !('durationMs' in value) || typeof value.durationMs !== 'number') throw new Error('Invalid transcription response.');
      return value.text;
    },
  };
}

export const speechApi = createSpeechApi();
