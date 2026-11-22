import { useCallback, useEffect, useRef, useState } from 'react';
import { Download } from 'lucide-react';
import { DecisionSettingsTransportError } from './decision-settings.transport';
import { LOCAL_DECISION_MODEL, isLocalDecisionJobSettled, isLocalDecisionManagerPage, localDecisionModelTransport,
  type LocalDecisionCatalog, type LocalDecisionJob, type LocalDecisionModelTransport } from './local-decision-model.transport';

interface Props {
  endpoint: string;
  value: string;
  onChange(value: string): void;
  disabled?: boolean;
  transport?: LocalDecisionModelTransport;
}
const mb = (bytes: number) => (bytes / 1000000).toFixed(1);
const gb = (bytes: number) => (bytes / 1000000000).toFixed(2);
function defaultConnection(endpoint: string): boolean {
  try {
    const url = new URL(endpoint.trim());
    return url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname)
      && url.port === '11434' && url.pathname === '/api/chat'
      && !url.username && !url.password && !url.search && !url.hash;
  } catch { return false; }
}

export function LocalDecisionModelControl({ endpoint, value, onChange, disabled = false, transport = localDecisionModelTransport }: Props) {
  const localPage = isLocalDecisionManagerPage();
  const available = localPage && defaultConnection(endpoint);
  const [catalog, setCatalog] = useState<LocalDecisionCatalog | null>(null);
  const [job, setJob] = useState<LocalDecisionJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<'install' | 'cancel' | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const [retryBlocked, setRetryBlocked] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const jobRef = useRef<LocalDecisionJob | null>(null);
  const requestId = useRef<string | null>(null);
  const generation = useRef(0);
  const action = useRef<AbortController | null>(null);

  const acceptJob = useCallback((next: LocalDecisionJob) => {
    const previous = jobRef.current;
    if (previous?.jobId === next.jobId && previous.revision >= next.revision) return;
    jobRef.current = next; setJob(next);
  }, []);
  useEffect(() => () => { ++generation.current; action.current?.abort(); }, []);
  useEffect(() => {
    if (!available || pending) return;
    const controller = new AbortController();
    const identity = ++generation.current;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const current = () => !controller.signal.aborted && generation.current === identity;
    const read = async () => {
      try {
        if (jobRef.current && !isLocalDecisionJobSettled(jobRef.current)) {
          const next = await transport.job(jobRef.current.jobId, controller.signal);
          if (!current()) return;
          acceptJob(next);
          if (jobRef.current && isLocalDecisionJobSettled(jobRef.current)) { setUncertain(false); setError(null); }
        }
        if (!jobRef.current || isLocalDecisionJobSettled(jobRef.current)) {
          const next = await transport.catalog(controller.signal);
          if (!current()) return;
          setCatalog(next);
          const recovered = next.activeJob ?? (requestId.current
            ? next.recentJobs.find((item) => item.requestId === requestId.current) : next.recentJobs[0]);
          if (recovered) {
            requestId.current = recovered.requestId; acceptJob(recovered); setUncertain(false); setRetryBlocked(false); setError(null);
          }
        }
        if (current() && jobRef.current && !isLocalDecisionJobSettled(jobRef.current)) timer = setTimeout(() => void read(), 2000);
      } catch {
        if (current()) { setCatalog(null); setError('Could not load local models. Refresh status to try again.'); }
      }
    };
    void read();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [acceptJob, available, pending, refresh, transport]);

  const mutate = async (cancel: boolean) => {
    if (action.current || disabled || !available) return;
    const currentJob = jobRef.current;
    if (cancel && !currentJob) return;
    const controller = new AbortController(); action.current = controller;
    ++generation.current; setPending(cancel ? 'cancel' : 'install'); setError(null);
    try {
      if (cancel && currentJob) {
        const result = await transport.cancel(currentJob.jobId, controller.signal);
        if (controller.signal.aborted) return;
        acceptJob(result);
      }
      else {
        if (!uncertain || !requestId.current) requestId.current = crypto.randomUUID();
        const result = await transport.install(LOCAL_DECISION_MODEL, requestId.current, controller.signal);
        if (controller.signal.aborted) return;
        acceptJob(result.job); setUncertain(false);
        setCatalog((previous) => previous ? { ...previous, models: [result.model] } : previous);
      }
    } catch (cause) {
      if (controller.signal.aborted) return;
      if (cancel) setError('Could not confirm cancellation. Refresh status before trying again.');
      else {
        setUncertain(true);
        const blocked = cause instanceof DecisionSettingsTransportError
          && ['OLLAMA_REQUEST_EXPIRED', 'OLLAMA_REQUEST_HISTORY_FULL', 'OLLAMA_REQUEST_ID_CONFLICT'].includes(cause.code);
        setRetryBlocked(blocked);
        setError(blocked ? 'This install request cannot be safely retried. Refresh status to check its outcome.'
          : 'The install request could not be confirmed. Refresh status or retry the same request.');
      }
    } finally {
      if (action.current === controller) action.current = null;
      if (!controller.signal.aborted) setPending(null);
    }
  };
  const model = catalog?.models[0];
  const active = job && !isLocalDecisionJobSettled(job);
  const ready = available && model?.installed && model.readiness === 'metadata_ready' && model.chatCompatible === true;
  const state = active ? job.state === 'pulling' ? 'Downloading model'
    : job.state === 'verifying' ? 'Checking downloaded model…'
    : job.state === 'cancel_requested' ? 'Cancelling download request…'
    : job.state === 'unknown' ? 'Request status unconfirmed' : 'Checking model…'
    : ready ? 'Installed'
    : model?.installed ? model.chatCompatible === false ? 'Not chat-compatible' : 'Compatibility unavailable'
    : catalog ? catalog.backendAvailable ? 'Not installed' : 'Ollama unavailable'
    : error ? 'Status unavailable' : 'Checking local models…';
  return <div className="space-y-3" data-testid="local-decision-model-control">
    <label className="form-control gap-1"><span>Decision model</span>
      <select aria-label="Decision model" className="select select-bordered w-full" value={value} disabled={disabled || !available} onChange={(event) => {
        if (!disabled && event.target.value === LOCAL_DECISION_MODEL && ready) onChange(event.target.value);
      }}>
        <option value="">Choose a model</option>
        {value && value !== LOCAL_DECISION_MODEL && <option value={value}>{value} · saved model</option>}
        <option value={LOCAL_DECISION_MODEL} disabled={!ready}>{model?.displayName ?? 'Qwen 3.5 2B'}</option>
      </select>
    </label>
    {!available ? <p className="text-sm text-base-content/70">{localPage
      ? 'Use localhost:11434 in Connection settings to manage models here.'
      : 'Model management is available in the local web app only.'}</p> : <div className="rounded-xl border border-base-300 bg-base-200/30 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <Download size={18} className="shrink-0 text-primary" aria-hidden="true" />
          <div><h3 className="text-sm font-semibold">{model?.displayName ?? 'Qwen 3.5 2B'}</h3>
            <p className="text-xs text-base-content/70">Local tool decisions</p></div>
        </div>
        <span role="status" className={`rounded-full px-2 py-1 text-xs ${ready && !active ? 'bg-success/10 text-success' : 'bg-base-300'}`}>{state}</span>
      </div>
      {model && <p className="mt-3 text-sm">{model.installed
        ? model.sizeBytes === null ? 'Installed size unavailable' : `${gb(model.sizeBytes)} GB installed`
        : `About ${gb(model.expectedSizeBytes)} GB download`}</p>}
      {catalog && !catalog.backendAvailable && <p className="mt-3 text-sm">Ollama is unavailable. Start it on this computer, then refresh status.</p>}
      {job?.state === 'pulling' && <div className="mt-3 space-y-2">
        <progress className="progress progress-primary block w-full" aria-label="Current model file download"
          value={job.progress.currentBlob?.completedBytes ?? undefined} max={job.progress.currentBlob?.totalBytes || undefined} />
        <p className="text-xs tabular-nums text-base-content/70">{job.progress.currentBlob && job.progress.currentBlob.completedBytes !== null
          ? `${mb(job.progress.currentBlob.completedBytes)} / ${mb(job.progress.currentBlob.totalBytes)} MB · current file` : 'Waiting for file progress…'}</p>
      </div>}
      {active && <p className="mt-3 text-xs text-base-content/70">Cancels this request only. Other downloads may continue; cached files are kept.</p>}
      {job?.state === 'unknown' && <p className="mt-3 text-sm">Request status is unconfirmed. Refresh status before starting another installation.</p>}
      {job?.state === 'cancelled' && <p className="mt-3 text-sm">Download request cancelled. Cached files are kept; other downloads may continue.</p>}
      {job?.state === 'failed' && <p role="alert" className="mt-3 text-sm text-error">Installation did not finish. Check status before trying again.</p>}
      {error && <p role="alert" className="mt-3 text-sm text-error">{error}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        {active ? <button type="button" className="btn btn-sm min-h-10" disabled={disabled || !!pending || job.state === 'cancel_requested'} onClick={() => void mutate(true)}>
          {pending === 'cancel' ? 'Cancelling…' : 'Cancel download request'}</button>
          : !retryBlocked && model?.installable && catalog?.backendAvailable && <button type="button" className="btn btn-primary btn-sm min-h-10" disabled={disabled || !!pending} onClick={() => void mutate(false)}>
            {pending === 'install' ? 'Starting…' : uncertain ? 'Retry install request' : 'Install'}</button>}
        <button type="button" className="btn btn-ghost btn-sm min-h-10" disabled={disabled || !!pending} onClick={() => { setError(null); setRefresh((value) => value + 1); }}>Refresh status</button>
      </div>
    </div>}
  </div>;
}
