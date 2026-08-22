import { CheckCircle2, Loader2, TriangleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ProjectIdeStatus } from '@kalio/types';

interface CodeIntelligenceQuickTrustProps {
  projectId: string;
}

export function CodeIntelligenceQuickTrust({ projectId }: CodeIntelligenceQuickTrustProps) {
  const [status, setStatus] = useState<ProjectIdeStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setConfirming(false);
    setError(null);
    void fetch(`/api/code-intelligence/projects/${encodeURIComponent(projectId)}/integration`)
      .then(async (response) => {
        if (!response.ok) throw new Error(`${response.status}: ${response.statusText}`);
        return response.json() as Promise<ProjectIdeStatus>;
      })
      .then((nextStatus) => {
        if (active) setStatus(nextStatus);
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : 'VS Code Bridge status unavailable.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [projectId]);

  if (loading) {
    return <p className="mt-2 flex items-center gap-1.5 text-xs text-base-content/55" role="status"><Loader2 size={12} className="animate-spin" /> Checking VS Code Bridge for this project…</p>;
  }

  if (error) {
    return <p className="mt-2 text-xs text-error" role="alert">VS Code Bridge: {error}</p>;
  }

  if (!status) return null;

  if (status.enabled && status.trustAcknowledged) {
    return <p className="mt-2 flex items-center gap-1.5 text-xs text-success" role="status"><CheckCircle2 size={12} /> VS Code Bridge enabled; first analysis starts it automatically.</p>;
  }

  const enable = async () => {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/code-intelligence/projects/${encodeURIComponent(projectId)}/integration`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: true, acknowledgedRisk: true }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { message?: string } | null;
        throw new Error(body?.message ?? `${response.status}: ${response.statusText}`);
      }
      setStatus(await response.json() as ProjectIdeStatus);
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : 'VS Code Bridge activation failed.');
    } finally {
      setSaving(false);
    }
  };

  return <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-warning/30 bg-warning/8 px-2.5 py-2 text-xs" role="region" aria-label="VS Code Bridge quick setup">
    <TriangleAlert size={13} className="shrink-0 text-warning" />
    <span className="text-base-content/70">VS Code Bridge is off for this project.</span>
    {!confirming && <button type="button" className="btn btn-xs btn-warning" onClick={() => setConfirming(true)} disabled={saving}>
      Enable VS Code Bridge
    </button>}
    {confirming && <div className="basis-full rounded-md border border-warning/30 bg-base-100/60 p-2">
      <p className="text-base-content/75">Language providers may execute project build scripts and proc macros on this host. Trust this project for VS Code code intelligence?</p>
      <div className="mt-2 flex gap-2">
        <button type="button" className="btn btn-xs btn-warning" onClick={() => void enable()} disabled={saving}>
          {saving && <Loader2 size={12} className="animate-spin" />}
          Confirm and enable
        </button>
        <button type="button" className="btn btn-xs btn-ghost" onClick={() => setConfirming(false)} disabled={saving}>Cancel</button>
      </div>
    </div>}
    {error && <span className="basis-full text-error" role="alert">{error}</span>}
  </div>;
}
