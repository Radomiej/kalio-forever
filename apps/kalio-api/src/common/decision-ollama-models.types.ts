/** Internal browser-manager v1 DTOs agreed with FE. Not decision authority. */
export const OLLAMA_MODEL_TAG = 'qwen3.5:2b-q4_K_M';
export const OLLAMA_MODEL_BYTES = 1945781358;
export const OLLAMA_ORIGIN = 'http://127.0.0.1:11434';
export const OLLAMA_MAX_MODEL_BYTES = 2 * 1024 * 1024 * 1024;
export const OLLAMA_JOB_ID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
export interface ModelRow {
  modelTag: string; displayName: string; expectedSizeBytes: number; installed: boolean;
  chatCompatible: boolean | null; readiness: 'not_installed' | 'metadata_ready' | 'incompatible' | 'unknown';
  sizeBytes: number | null; digest: string | null; capabilities: string[]; installable: boolean;
}
export interface JobError { code: string; message: string }
export interface Progress {
  completedBytes: number; observedTotalBytes: number;
  currentBlob: { digest: string; completedBytes: number | null; totalBytes: number } | null;
}
export type JobState = 'checking' | 'pulling' | 'verifying' | 'installed' | 'cancel_requested' | 'cancelled' | 'failed' | 'unknown';
export interface ModelJob {
  jobId: string; requestId: string; modelTag: string; revision: number; state: JobState;
  progress: Progress; error: JobError | null; cancelScope: 'request_only'; createdAt: number; updatedAt: number;
}
export interface ModelCatalog {
  version: 1; backendAvailable: boolean; backendError: JobError | null; models: ModelRow[];
  activeJob: ModelJob | null; recentJobs: ModelJob[];
}
export interface InstallBody { outcome: 'already_installed' | 'started' | 'existing_job'; model: ModelRow; job: ModelJob }
export function modelError(code: string): JobError {
  const messages: Record<string, string> = {
    OLLAMA_INVALID_REQUEST: 'Invalid local model request.', OLLAMA_UNAVAILABLE: 'Local Ollama is unavailable.',
    OLLAMA_METADATA_UNAVAILABLE: 'Local model metadata could not be verified.',
    OLLAMA_MODEL_INCOMPATIBLE: 'The installed model is not confirmed chat-compatible.',
    OLLAMA_INSTALL_BUSY: 'Another managed install request is still active.',
    OLLAMA_REQUEST_EXPIRED: 'This request is no longer retained; its outcome must not be replayed.',
    OLLAMA_REQUEST_HISTORY_FULL: 'The bounded install request history is full.',
    OLLAMA_REQUEST_ID_CONFLICT: 'This request identifier belongs to another operation.',
    OLLAMA_JOB_NOT_FOUND: 'The managed install job is unknown or expired.',
    OLLAMA_PULL_FAILED: 'Ollama could not finish the model download.',
    OLLAMA_INVALID_PROGRESS: 'Ollama returned invalid download progress.',
    OLLAMA_SIZE_LIMIT: 'The reported model or response size exceeds the local limit.',
    OLLAMA_PULL_TIMEOUT: 'The managed install request exceeded its time limit.',
    OLLAMA_CANCEL_UNCERTAIN: 'Kalio could not confirm its own request has drained.',
  };
  return { code, message: messages[code] ?? 'The local model operation could not be completed.' };
}
export class OllamaModelError extends Error {
  constructor(readonly code: string, readonly status = 503) { super(modelError(code).message); }
}
export function defaultModel(): ModelRow {
  return { modelTag: OLLAMA_MODEL_TAG, displayName: 'Qwen3.5 2B Q4_K_M', expectedSizeBytes: OLLAMA_MODEL_BYTES,
    installed: false, chatCompatible: null, readiness: 'unknown', sizeBytes: null, digest: null,
    capabilities: [], installable: false };
}
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function boundedRead<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new OllamaModelError('OLLAMA_UNAVAILABLE'));
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener('abort', abort); reject(new OllamaModelError('OLLAMA_UNAVAILABLE')); };
    signal.addEventListener('abort', abort, { once: true });
    promise.then(value => { signal.removeEventListener('abort', abort); resolve(value); },
      () => { signal.removeEventListener('abort', abort); reject(new OllamaModelError('OLLAMA_UNAVAILABLE')); });
  });
}
