import { useCallback, useEffect, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import type { CLIAgentAdapterInfo } from '@kalio/types';
import { AdapterCard } from './CLIAgentPanel.AdapterCard';

export function CLIAgentPanel() {
  const [adapters, setAdapters] = useState<CLIAgentAdapterInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  /** Load cached results from BE (instant - no probing on this request). */
  const loadAdapters = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch('/api/cli-agents');
      if (!res.ok) throw new Error(`${res.status}: ${res.statusText}`);
      const data = await res.json() as CLIAgentAdapterInfo[];
      setAdapters(data);
    } catch (err: unknown) {
      setLoadError(err instanceof Error ? err.message : 'Load failed');
    } finally {
      setLoading(false);
    }
  }, []);

  /** Force BE to re-probe all adapters, then reload. */
  const refreshProbes = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch('/api/cli-agents/refresh', { method: 'POST' });
      if (!res.ok) throw new Error(`${res.status}: ${res.statusText}`);
      const data = await res.json() as CLIAgentAdapterInfo[];
      setAdapters(data);
    } catch (err: unknown) {
      setLoadError(err instanceof Error ? err.message : 'Refresh failed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadAdapters(); }, [loadAdapters]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-base font-semibold mb-1">CLI Coding Agents</h3>
          <p className="text-sm text-base-content/60">
            Kalio can delegate coding tasks to external CLI agents. Configure each adapter below.
          </p>
        </div>
        <button
          className="btn btn-xs btn-ghost gap-1"
          disabled={loading}
          onClick={() => void refreshProbes()}
          title="Re-probe all CLI agents"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      <div className="rounded-xl border border-sky-500/20 bg-sky-500/8 px-4 py-3 text-sm text-base-content/75">
        <p>
          Recommended durable supervision stack for forever loops and repo browsing: <strong>Gemini -&gt; Copilot -&gt; Codex</strong>.
        </p>
        <p className="mt-2 text-xs text-base-content/60">
          Add the repo under Settings -&gt; Allowed Paths, then let the parent agent keep a child session alive with <code className="font-mono">spawn_cli_agent</code>,
          steer it with <code className="font-mono">message_cli_agent</code>, inspect it with <code className="font-mono">get_cli_agent_status</code>,
          and interrupt it with <code className="font-mono">stop_cli_agent</code>.
        </p>
      </div>

      {loadError && (
        <div className="alert alert-error text-sm">{loadError}</div>
      )}

      {loading && adapters.length === 0 ? (
        <div className="flex items-center gap-2 text-sm text-base-content/50">
          <Loader2 size={14} className="animate-spin" />
          Probing installed CLI agents...
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {adapters.map((a) => (
            <AdapterCard key={a.id} info={a} />
          ))}
        </div>
      )}
    </div>
  );
}
