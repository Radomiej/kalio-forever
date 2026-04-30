import { useState, useEffect, useCallback } from 'react';
import { CheckCircle2, XCircle, Loader2, RefreshCw, Terminal } from 'lucide-react';

interface ProbeResult {
  available: boolean;
  version: string | null;
}

export function ToolsPanel() {
  const [probe, setProbe] = useState<ProbeResult | null>(null);
  const [probing, setProbing] = useState(false);
  const [probeError, setProbeError] = useState<string | null>(null);

  const runProbe = useCallback(async () => {
    setProbing(true);
    setProbeError(null);
    try {
      const res = await fetch('/api/tools/cli-agent/probe');
      if (!res.ok) throw new Error(`${res.status}: ${res.statusText}`);
      const data = (await res.json()) as ProbeResult;
      setProbe(data);
    } catch (err) {
      setProbeError(err instanceof Error ? err.message : 'Probe failed');
    } finally {
      setProbing(false);
    }
  }, []);

  useEffect(() => { void runProbe(); }, [runProbe]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h3 className="text-base font-semibold mb-1">External Tools</h3>
        <p className="text-sm text-base-content/60">
          Configure optional external CLI tools that Kalio can invoke as coding agents.
        </p>
      </div>

      {/* Copilot CLI card */}
      <div className="border border-base-300 rounded-lg overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-3 bg-base-200/50 border-b border-base-300">
          <Terminal size={16} className="text-sky-400 shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium">GitHub Copilot CLI</div>
            <div className="text-xs text-base-content/50">
              Delegates coding tasks to <code className="font-mono">copilot -p</code>
            </div>
          </div>
          <button
            className="btn btn-ghost btn-xs p-1"
            onClick={() => void runProbe()}
            disabled={probing}
            title="Re-check"
          >
            {probing ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
          </button>
        </div>

        <div className="px-4 py-3 flex flex-col gap-3">
          {/* Status row */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-base-content/60 w-20 shrink-0">Status</span>
            {probing && !probe && (
              <span className="flex items-center gap-1.5 text-xs text-base-content/50">
                <Loader2 size={11} className="animate-spin" /> Checking…
              </span>
            )}
            {probeError && (
              <span className="flex items-center gap-1.5 text-xs text-error">
                <XCircle size={11} /> Error: {probeError}
              </span>
            )}
            {probe && !probing && (
              probe.available ? (
                <span className="flex items-center gap-1.5 text-xs text-success">
                  <CheckCircle2 size={11} />
                  Available
                  {probe.version && (
                    <code className="font-mono text-[10px] bg-base-300 rounded px-1">{probe.version}</code>
                  )}
                </span>
              ) : (
                <span className="flex items-center gap-1.5 text-xs text-error">
                  <XCircle size={11} /> Not found
                </span>
              )
            )}
          </div>

          {/* How to install hint */}
          {probe && !probe.available && (
            <div className="bg-warning/10 border border-warning/30 rounded-md px-3 py-2 text-xs text-warning/90 leading-relaxed">
              <strong>Install GitHub Copilot CLI:</strong>
              <ol className="mt-1 ml-4 list-decimal space-y-0.5">
                <li>Install the <strong>GitHub Copilot</strong> extension in VS Code</li>
                <li>Enable <em>Copilot in the CLI</em> in your GitHub account settings</li>
                <li>Run <code className="font-mono bg-base-300/60 rounded px-0.5">gh auth login</code> and authenticate</li>
                <li>Run <code className="font-mono bg-base-300/60 rounded px-0.5">gh extension install github/gh-copilot</code></li>
                <li>Verify: <code className="font-mono bg-base-300/60 rounded px-0.5">copilot --version</code></li>
              </ol>
            </div>
          )}

          {/* Usage notes */}
          {probe?.available && (
            <div className="bg-base-200/60 rounded-md px-3 py-2 text-xs text-base-content/60 leading-relaxed space-y-1">
              <p>
                Use the <strong>Dev</strong> persona to access <code className="font-mono">run_cli_agent</code>.
                The tool requires a project directory registered in{' '}
                <span className="text-sky-400 font-medium">Settings → Allowed Paths</span>.
              </p>
              <p>
                Copilot CLI will read, write, and run commands in the specified directory.
                Each invocation can take up to 20 minutes.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
