import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Loader2, RefreshCw, RotateCcw, ServerCog, XCircle } from 'lucide-react';

type NativeCliIntegrationStatus = {
  id: string;
  provider: string;
  displayName: string;
  kind: string;
  authProfileId: string;
  status: 'offline' | 'starting' | 'online' | 'error';
  connected: boolean;
  openSessionCount: number;
  processEpoch?: string;
  lastError?: string;
  profileIds: string[];
  models: string[];
  mcp: {
    inheritConfiguredMcp: boolean;
    source: 'settings' | 'environment' | 'default';
  };
};

type IntegrationAction = `${string}:check` | `${string}:reset` | `${string}:mcp`;

export function NativeCliIntegrationsPanel() {
  const [integrations, setIntegrations] = useState<NativeCliIntegrationStatus[]>([]);
  const [loading, setLoading] = useState(false);
  const [action, setAction] = useState<IntegrationAction | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadIntegrations = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/runtime/native-cli-integrations');
      if (!response.ok) throw new Error(`${response.status}: ${response.statusText}`);
      setIntegrations(await response.json() as NativeCliIntegrationStatus[]);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load native CLI integrations.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadIntegrations();
  }, [loadIntegrations]);

  const runAction = async (integration: NativeCliIntegrationStatus, kind: 'check' | 'reset') => {
    if (kind === 'reset' && !window.confirm(`Reset the ${integration.displayName} server? Open native sessions will be disconnected.`)) {
      return;
    }

    const actionId = `${integration.authProfileId}:${kind}` as IntegrationAction;
    setAction(actionId);
    setError(null);
    try {
      const response = await fetch(`/api/runtime/native-cli-integrations/${encodeURIComponent(integration.authProfileId)}/${kind}`, {
        method: 'POST',
      });
      if (!response.ok) {
        const body = await response.json().catch((err: unknown) => {
          console.debug('[NativeCliIntegrationsPanel] action error response was not JSON', err);
          return null;
        }) as { message?: string } | null;
        throw new Error(body?.message ?? `${response.status}: ${response.statusText}`);
      }
      const updated = await response.json() as NativeCliIntegrationStatus;
      setIntegrations((current) => current.map((item) => item.authProfileId === updated.authProfileId ? updated : item));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : `Failed to ${kind} native CLI integration.`);
    } finally {
      setAction(null);
    }
  };

  const updateMcpPolicy = async (integration: NativeCliIntegrationStatus, inheritConfiguredMcp: boolean) => {
    const actionId = `${integration.authProfileId}:mcp` as IntegrationAction;
    setAction(actionId);
    setError(null);
    try {
      const response = await fetch(`/api/runtime/native-cli-integrations/${encodeURIComponent(integration.authProfileId)}/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inheritConfiguredMcp }),
      });
      if (!response.ok) {
        const body = await response.json().catch((err: unknown) => {
          console.debug('[NativeCliIntegrationsPanel] MCP policy error response was not JSON', err);
          return null;
        }) as { message?: string } | null;
        throw new Error(body?.message ?? `${response.status}: ${response.statusText}`);
      }
      await loadIntegrations();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to update Codex MCP policy.');
    } finally {
      setAction(null);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-base font-semibold mb-1">Native CLI integrations</h3>
          <p className="text-sm text-base-content/60">
            Monitor the native app-server bridge used by Codex and future CLI providers.
          </p>
        </div>
        <button
          type="button"
          className="btn btn-xs btn-ghost gap-1"
          disabled={loading}
          onClick={() => void loadIntegrations()}
          title="Refresh integration status"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      <div className="rounded-xl border border-sky-500/20 bg-sky-500/8 px-4 py-3 text-sm text-base-content/75">
        <p>Each integration is supervised by Kalio, while its sessions stay bound to the configured auth profile.</p>
        <p className="mt-2 text-xs text-base-content/60">
          Check starts the app server when needed. Reset closes its process and clears the tracked native sessions.
        </p>
        <p className="mt-2 text-xs text-base-content/60">
          Codex profile MCP servers are blocked by default; Kalio passes only its policy-filtered tools. Use the per-integration switch below only when external Codex MCP access is intentional.
        </p>
      </div>

      {error && <div className="alert alert-error text-sm" role="alert">{error}</div>}

      {loading && integrations.length === 0 ? (
        <div className="flex items-center gap-2 text-sm text-base-content/50">
          <Loader2 size={14} className="animate-spin" />
          Loading native integration status...
        </div>
      ) : integrations.length === 0 ? (
        <div className="rounded-lg border border-base-300 px-4 py-5 text-sm text-base-content/60">
          No native CLI integrations are configured yet.
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {integrations.map((integration) => {
            const checkAction = `${integration.authProfileId}:check` as IntegrationAction;
            const resetAction = `${integration.authProfileId}:reset` as IntegrationAction;
            return (
              <div key={integration.id} className="rounded-lg border border-base-300 overflow-hidden">
                <div className="flex items-center gap-3 bg-base-200/40 px-4 py-3">
                  <ServerCog size={17} className="shrink-0 text-base-content/55" />
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-sm">{integration.displayName}</div>
                    <div className="text-xs text-base-content/55">{integration.kind} · auth {integration.authProfileId}</div>
                  </div>
                  <StatusBadge status={integration.status} />
                </div>

                <div className="flex flex-col gap-3 px-4 py-3">
                  <div className="grid gap-2 text-xs text-base-content/65 sm:grid-cols-2">
                    <div><span className="text-base-content/45">Native sessions:</span> {integration.openSessionCount} open sessions</div>
                    <div><span className="text-base-content/45">Connection:</span> {integration.connected ? 'connected' : 'not connected'}</div>
                    <div><span className="text-base-content/45">Models:</span> {integration.models.join(', ') || 'none'}</div>
                    <div><span className="text-base-content/45">Profiles:</span> {integration.profileIds.join(', ') || 'none'}</div>
                  </div>
                  <div className="rounded-lg border border-base-300 bg-base-200/20 px-3 py-3">
                    <label className="flex items-start gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        className="checkbox checkbox-sm mt-0.5"
                        checked={integration.mcp.inheritConfiguredMcp}
                        disabled={action !== null}
                        onChange={(event) => void updateMcpPolicy(integration, event.target.checked)}
                        aria-label="Allow Codex profile MCP servers"
                      />
                      <span>
                        <span className="block text-sm font-medium">Allow Codex profile MCP servers</span>
                        <span className="mt-1 block text-xs text-base-content/55">
                          {integration.mcp.inheritConfiguredMcp
                            ? 'Enabled: external MCP servers configured in Codex can start with this integration.'
                            : 'Disabled: external Codex MCP servers are explicitly disabled at process start.'}
                        </span>
                        <span className="mt-1 block text-[11px] text-base-content/40">Source: {integration.mcp.source}</span>
                      </span>
                    </label>
                  </div>
                  {integration.processEpoch && (
                    <div className="font-mono text-[11px] text-base-content/40 break-all">process {integration.processEpoch}</div>
                  )}
                  {integration.lastError && <div className="text-xs text-error">{integration.lastError}</div>}
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      className="btn btn-xs btn-primary gap-1"
                      disabled={action !== null}
                      onClick={() => void runAction(integration, 'check')}
                    >
                      {action === checkAction ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
                      Check
                    </button>
                    <button
                      type="button"
                      className="btn btn-xs btn-ghost gap-1 text-warning"
                      disabled={action !== null}
                      onClick={() => void runAction(integration, 'reset')}
                    >
                      {action === resetAction ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />}
                      Reset
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: NativeCliIntegrationStatus['status'] }) {
  const online = status === 'online';
  const starting = status === 'starting';
  return (
    <span className={`inline-flex items-center gap-1 text-xs ${online ? 'text-success' : starting ? 'text-warning' : 'text-error'}`}>
      {online ? <CheckCircle2 size={12} /> : starting ? <Loader2 size={12} className="animate-spin" /> : <XCircle size={12} />}
      {online ? 'Online' : starting ? 'Starting' : status === 'error' ? 'Error' : 'Not started'}
    </span>
  );
}
