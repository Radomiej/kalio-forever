import { createDecisionSettingsRequest } from './decision-settings.transport';

export const LOCAL_DECISION_MODEL = 'qwen3.5:2b-q4_K_M';
const EXPECTED_BYTES = 1945781358;
const BYTE_LIMIT = 2 ** 31;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const REQUEST_ID = /^[A-Za-z0-9_-]{1,80}$/;
const DIGEST = /^(?:sha256:)?[a-f0-9]{64}$/i;
const STATES = ['checking', 'pulling', 'verifying', 'installed', 'cancel_requested', 'cancelled', 'failed', 'unknown'] as const;
const READINESS = ['not_installed', 'metadata_ready', 'incompatible', 'unknown'] as const;

function invalid(): never { throw new Error('Invalid local model response.'); }
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== keys.length || keys.some((key) => !Object.hasOwn(record, key))) return invalid();
  return record;
}
function text(value: unknown, max = 200): string {
  if (typeof value !== 'string' || !value.length || value.length > max) return invalid();
  return value;
}
function count(value: unknown, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > max) return invalid();
  return value;
}
function boolean(value: unknown): boolean { return typeof value === 'boolean' ? value : invalid(); }
function choice<const T extends readonly string[]>(value: unknown, values: T): T[number] {
  return typeof value === 'string' && values.includes(value) ? value as T[number] : invalid();
}
function error(value: unknown) {
  if (value === null) return null;
  const v = object(value, ['code', 'message']);
  return { code: text(v.code, 100), message: text(v.message, 500) };
}
function digest(value: unknown): string { const result = text(value, 71); return DIGEST.test(result) ? result : invalid(); }
function parseModel(value: unknown) {
  const v = object(value, ['modelTag', 'displayName', 'expectedSizeBytes', 'installed', 'chatCompatible', 'readiness', 'sizeBytes', 'digest', 'capabilities', 'installable']);
  if (v.modelTag !== LOCAL_DECISION_MODEL || v.expectedSizeBytes !== EXPECTED_BYTES
    || !Array.isArray(v.capabilities) || v.capabilities.length > 128) return invalid();
  const model = {
    modelTag: LOCAL_DECISION_MODEL, displayName: text(v.displayName), expectedSizeBytes: EXPECTED_BYTES,
    installed: boolean(v.installed), chatCompatible: v.chatCompatible === null ? null : boolean(v.chatCompatible),
    readiness: choice(v.readiness, READINESS), sizeBytes: v.sizeBytes === null ? null : count(v.sizeBytes, BYTE_LIMIT),
    digest: v.digest === null ? null : digest(v.digest), capabilities: v.capabilities.map((item: unknown) => text(item, 100)), installable: boolean(v.installable),
  };
  if (model.readiness === 'metadata_ready' && (!model.installed || model.chatCompatible !== true || !model.capabilities.includes('completion') || model.sizeBytes === null || model.digest === null)
    || model.installed && model.installable
    || model.readiness === 'not_installed' && model.installed
    || model.readiness === 'incompatible' && model.chatCompatible !== false) return invalid();
  return model;
}
function parseCurrentBlob(value: unknown) {
  if (value === null) return null;
  const v = object(value, ['digest', 'completedBytes', 'totalBytes']);
  const blob = { digest: digest(v.digest), completedBytes: v.completedBytes === null ? null : count(v.completedBytes, BYTE_LIMIT), totalBytes: count(v.totalBytes, BYTE_LIMIT) };
  if ((blob.completedBytes ?? 0) > blob.totalBytes) return invalid();
  return blob;
}
export function parseLocalDecisionJob(value: unknown) {
  const v = object(value, ['jobId', 'requestId', 'modelTag', 'revision', 'state', 'progress', 'error', 'cancelScope', 'createdAt', 'updatedAt']);
  const jobId = text(v.jobId); const requestId = text(v.requestId);
  if (!UUID.test(jobId) || !REQUEST_ID.test(requestId) || v.modelTag !== LOCAL_DECISION_MODEL
    || v.cancelScope !== 'request_only') return invalid();
  const p = object(v.progress, ['completedBytes', 'observedTotalBytes', 'currentBlob']);
  const progress = {
    completedBytes: count(p.completedBytes, BYTE_LIMIT), observedTotalBytes: count(p.observedTotalBytes, BYTE_LIMIT), currentBlob: parseCurrentBlob(p.currentBlob),
  };
  if (progress.completedBytes > progress.observedTotalBytes) return invalid();
  return { jobId, requestId, modelTag: LOCAL_DECISION_MODEL,
    revision: count(v.revision), state: choice(v.state, STATES), progress, error: error(v.error), cancelScope: 'request_only' as const,
    createdAt: count(v.createdAt), updatedAt: count(v.updatedAt) };
}
export function parseLocalDecisionCatalog(value: unknown) {
  const v = object(value, ['version', 'backendAvailable', 'backendError', 'models', 'activeJob', 'recentJobs']);
  if (v.version !== 1 || !Array.isArray(v.models) || v.models.length !== 1 || !Array.isArray(v.recentJobs) || v.recentJobs.length > 16) return invalid();
  const catalog = {
    version: 1 as const, backendAvailable: boolean(v.backendAvailable), backendError: error(v.backendError), models: v.models.map(parseModel),
    activeJob: v.activeJob === null ? null : parseLocalDecisionJob(v.activeJob), recentJobs: v.recentJobs.map(parseLocalDecisionJob),
  };
  if (!catalog.backendAvailable && catalog.models.some((model) => model.installable)) return invalid();
  return catalog;
}

export type LocalDecisionModel = ReturnType<typeof parseModel>;
export type LocalDecisionJob = ReturnType<typeof parseLocalDecisionJob>;
export type LocalDecisionCatalog = ReturnType<typeof parseLocalDecisionCatalog>;

export function isLocalDecisionManagerPage(): boolean {
  return ['http:', 'https:'].includes(globalThis.location?.protocol)
    && ['localhost', '127.0.0.1', '[::1]'].includes(globalThis.location?.hostname);
}
export function isLocalDecisionJobSettled(job: LocalDecisionJob): boolean {
  return ['installed', 'cancelled', 'failed'].includes(job.state);
}
export function createLocalDecisionModelTransport(fetcher?: typeof fetch) {
  const request = createDecisionSettingsRequest(fetcher);
  const jobPath = (jobId: string) => {
    if (!UUID.test(jobId)) throw new Error('Invalid local model job ID.');
    return `/api/decision/ollama/install/${jobId}` as const;
  };
  return {
    async catalog(signal?: AbortSignal) { return parseLocalDecisionCatalog(await (await request('/api/decision/ollama/models', { signal })).json()); },
    async install(modelTag: string, requestId: string, signal?: AbortSignal) {
      if (modelTag !== LOCAL_DECISION_MODEL || !REQUEST_ID.test(requestId)) throw new Error('Invalid local model install request.');
      const body = await (await request('/api/decision/ollama/install', { method: 'PUT', body: JSON.stringify({ modelTag, requestId }), signal })).json() as unknown;
      const v = object(body, ['outcome', 'model', 'job']);
      const outcome = choice(v.outcome, ['already_installed', 'started', 'existing_job'] as const);
      const model = parseModel(v.model); const job = parseLocalDecisionJob(v.job);
      if (job.requestId !== requestId || outcome === 'already_installed' && (model.readiness !== 'metadata_ready' || job.state !== 'installed')) return invalid();
      return { outcome, model, job };
    },
    async job(jobId: string, signal?: AbortSignal) {
      const v = object(await (await request(jobPath(jobId), { signal })).json(), ['job']);
      const job = parseLocalDecisionJob(v.job);
      return job.jobId === jobId ? job : invalid();
    },
    async cancel(jobId: string, signal?: AbortSignal) {
      const v = object(await (await request(`${jobPath(jobId)}/cancel`, { method: 'PUT', body: '{}', signal })).json(), ['job']);
      const job = parseLocalDecisionJob(v.job);
      return job.jobId === jobId ? job : invalid();
    },
  };
}
export type LocalDecisionModelTransport = ReturnType<typeof createLocalDecisionModelTransport>;
export const localDecisionModelTransport = createLocalDecisionModelTransport();
