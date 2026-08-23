import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, ChevronDown, CircleAlert, Loader2, RefreshCw, RotateCcw, Square, TriangleAlert } from 'lucide-react';
import type { CodeIntelligenceIntegrationStatus, IdeRuntimeLifecycle, ProjectIdeStatus } from '@kalio/types';

export function CodeIntelligencePanel() {
  const [status, setStatus] = useState<CodeIntelligenceIntegrationStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/code-intelligence/integration');
      if (!response.ok) throw new Error(`${response.status}: ${response.statusText}`);
      setStatus(await response.json() as CodeIntelligenceIntegrationStatus);
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : 'Failed to load VS Code integration.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const refreshDetection = async () => {
    setAction('detect');
    try {
      const response = await fetch('/api/code-intelligence/integration/detect', { method: 'POST' });
      if (!response.ok) throw new Error(`${response.status}: ${response.statusText}`);
      setStatus(await response.json() as CodeIntelligenceIntegrationStatus);
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : 'VS Code detection failed.');
    } finally {
      setAction(null);
    }
  };

  const updateGlobal = async (patch: { enabled?: boolean; autoStart?: boolean }) => {
    setAction('global');
    try {
      const response = await fetch('/api/code-intelligence/integration', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
      if (!response.ok) throw new Error(`${response.status}: ${response.statusText}`);
      setStatus(await response.json() as CodeIntelligenceIntegrationStatus);
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : 'Integration settings update failed.');
    } finally {
      setAction(null);
    }
  };

  const projectAction = async (project: ProjectIdeStatus, kind: 'enable' | 'test' | 'restart' | 'stop') => {
    if (kind === 'enable' && !window.confirm('VS Code language providers may execute project build scripts and proc macros. Trust this project for code intelligence?')) return;
    setAction(`${project.projectId}:${kind}`);
    try {
      const endpoint = kind === 'enable'
        ? `/api/code-intelligence/projects/${encodeURIComponent(project.projectId)}/integration`
        : `/api/code-intelligence/projects/${encodeURIComponent(project.projectId)}/${kind}`;
      const response = await fetch(endpoint, {
        method: kind === 'enable' ? 'PATCH' : 'POST',
        headers: kind === 'enable' ? { 'Content-Type': 'application/json' } : undefined,
        body: kind === 'enable' ? JSON.stringify({ enabled: true, acknowledgedRisk: true }) : undefined,
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { message?: string } | null;
        throw new Error(body?.message ?? `${response.status}: ${response.statusText}`);
      }
      const updated = await response.json() as ProjectIdeStatus;
      setStatus((current) => current ? { ...current, projects: current.projects.map((item) => item.projectId === updated.projectId ? updated : item) } : current);
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : `VS Code ${kind} failed.`);
    } finally {
      setAction(null);
    }
  };

  return (
    <section className="flex flex-col gap-5" aria-labelledby="code-intelligence-title">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 id="code-intelligence-title" className="text-base font-semibold">VS Code</h3>
        </div>
        <button type="button" className="btn btn-xs btn-ghost gap-1" onClick={() => void refreshDetection()} disabled={loading || action !== null}>
          {action === 'detect' ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
          Rescan
        </button>
      </div>

      {error && <div className="alert alert-error text-sm" role="alert">{error}</div>}
      {loading && !status ? <div className="flex items-center gap-2 text-sm text-base-content/50"><Loader2 size={14} className="animate-spin" />Checking...</div> : status && (
        <>
          <div className="rounded-xl border border-base-300 bg-base-200/20 p-3">
            <div className="grid gap-2 sm:grid-cols-3">
              <Fact label="VS Code" value={status.vscodeVersion ?? (status.platformSupported ? 'Detected' : 'Unsupported')} ok={status.platformSupported} />
              <Fact label="Bridge" value={status.bridgeVersion ?? (status.bridgeInstalled ? 'Installed' : 'Missing')} ok={status.bridgeInstalled && status.bridgeCompatible} />
              <Fact label="Runtimes" value={`${status.activeRuntimeCount}/${status.maxManagedRuntimes}`} ok={status.activeRuntimeCount < status.maxManagedRuntimes} />
            </div>
            <details className="mt-3 border-t border-base-300/70 pt-2">
              <summary className="flex cursor-pointer list-none items-center gap-1 text-xs text-base-content/50 hover:text-base-content/80">
                Settings
                <ChevronDown size={12} />
              </summary>
              <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm">
                <label className="flex items-center gap-2"><input type="checkbox" className="toggle toggle-sm" checked={status.enabled} onChange={(event) => void updateGlobal({ enabled: event.target.checked })} disabled={action !== null} /> Enable backend</label>
                <label className="flex items-center gap-2"><input type="checkbox" className="toggle toggle-sm" checked={status.autoStart} onChange={(event) => void updateGlobal({ autoStart: event.target.checked })} disabled={action !== null || !status.enabled} /> Auto-start</label>
              </div>
            </details>
          </div>
          <details className="rounded-xl border border-warning/30 bg-warning/8 px-3 py-2.5 text-sm">
            <summary className="flex cursor-pointer list-none items-center gap-2 text-base-content/75">
              <TriangleAlert size={15} className="shrink-0 text-warning" />
              Workspace permissions
              <ChevronDown size={12} className="ml-auto" />
            </summary>
            <div className="mt-3 border-t border-warning/20 pt-3 text-xs text-base-content/60">
              <p>VS Code providers run with host permissions. Enable only projects you trust.</p>
              <label className="mt-3 flex items-center gap-2"><input type="checkbox" className="toggle toggle-sm" checked={false} disabled /> Allow in VFS sandbox <span className="text-xs">Unavailable</span></label>
            </div>
          </details>
          <div className="flex flex-col gap-3">
            <h4 className="text-sm font-semibold">Projects</h4>
            {status.projects.length === 0 ? <div className="rounded-lg border border-base-300 px-4 py-4 text-sm text-base-content/60">No workspace projects are configured.</div> : status.projects.map((project) => <ProjectCard key={project.projectId} project={project} action={action} onAction={projectAction} />)}
          </div>
        </>
      )}
    </section>
  );
}

function ProjectCard({ project, action, onAction }: { project: ProjectIdeStatus; action: string | null; onAction: (project: ProjectIdeStatus, kind: 'enable' | 'test' | 'restart' | 'stop') => Promise<void> }) {
  const enabled = project.enabled;
  const trustLabel = project.workspaceTrusted ? 'Trusted' : project.trustAcknowledged ? 'Waiting' : 'Not trusted';
  return <article className="overflow-hidden rounded-xl border border-base-300">
    <div className="flex items-center gap-3 bg-base-200/40 px-4 py-3"><StatusIcon lifecycle={project.lifecycle} /><div className="min-w-0 flex-1"><div className="truncate text-sm font-semibold">{project.projectName ?? project.projectId}</div><div className="mt-0.5 text-[11px] text-base-content/45">{trustLabel} · {project.bridgeCompatible ? 'Bridge ready' : 'Bridge not ready'}</div></div><StatusBadge lifecycle={project.lifecycle} /></div>
    <div className="flex flex-col gap-3 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2 text-xs text-base-content/60">
        <span className="rounded-md bg-base-200/70 px-2 py-1">Workspace {trustLabel}</span>
        <span className={`rounded-md px-2 py-1 ${project.bridgeCompatible ? 'bg-success/10 text-success' : 'bg-base-200/70'}`}>Bridge {project.bridgeCompatible ? 'Ready' : 'Not ready'}</span>
        <details className="ml-auto">
          <summary className="flex cursor-pointer list-none items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-base-content/50 hover:bg-base-200/70 hover:text-base-content/80">Details <ChevronDown size={12} /></summary>
          <div className="mt-2 rounded-lg border border-base-300/70 bg-base-200/25 p-3 text-[11px] text-base-content/60">
            <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
              <div><dt className="text-base-content/40">Lifecycle</dt><dd>{project.lifecycle}{project.errorCode ? ` · ${project.errorCode}` : ''}</dd></div>
              <div><dt className="text-base-content/40">Languages</dt><dd>{project.languages.map((language) => `${language.displayName} (${language.lifecycle})`).join(', ') || 'Not detected'}</dd></div>
            </dl>
            {project.message && <p className="mt-2 text-warning">{project.message}</p>}
          </div>
        </details>
      </div>
      <div className="flex flex-wrap gap-2">{!enabled && <button type="button" className="btn btn-xs btn-primary" disabled={action !== null} onClick={() => void onAction(project, 'enable')}>{action === `${project.projectId}:enable` ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />} Enable & trust</button>}{enabled && <><button type="button" className="btn btn-xs btn-primary" disabled={action !== null} onClick={() => void onAction(project, 'test')}>{action === `${project.projectId}:test` ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />} Test</button><button type="button" className="btn btn-xs btn-ghost" disabled={action !== null} onClick={() => void onAction(project, 'restart')}><RotateCcw size={12} /> Restart</button><button type="button" className="btn btn-xs btn-ghost text-warning" disabled={action !== null} onClick={() => void onAction(project, 'stop')}><Square size={12} /> Stop</button></>}</div>
    </div>
  </article>;
}

function Fact({ label, value, ok }: { label: string; value: string; ok: boolean }) { return <div className="flex items-center justify-between gap-3 text-sm"><span className="text-base-content/55">{label}</span><span className={ok ? 'text-success' : 'text-warning'}>{value}</span></div>; }
function StatusIcon({ lifecycle }: { lifecycle: IdeRuntimeLifecycle }) { return lifecycle === 'ready' ? <CheckCircle2 size={17} className="text-success" /> : lifecycle === 'starting' || lifecycle === 'indexing' ? <Loader2 size={17} className="animate-spin text-warning" /> : <CircleAlert size={17} className="text-base-content/45" />; }
function StatusBadge({ lifecycle }: { lifecycle: IdeRuntimeLifecycle }) { const good = lifecycle === 'ready'; const busy = lifecycle === 'starting' || lifecycle === 'indexing'; return <span className={`text-xs ${good ? 'text-success' : busy ? 'text-warning' : 'text-base-content/55'}`}>{good ? 'Ready' : busy ? 'Working' : lifecycle.replace('_', ' ')}</span>; }
