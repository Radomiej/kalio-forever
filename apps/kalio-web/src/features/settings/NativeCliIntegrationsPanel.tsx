import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, ChevronDown, Loader2, RefreshCw, RotateCcw, ServerCog, XCircle } from 'lucide-react';

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

type IntegrationAction = `${string}:check` | `${string}:reset` | `${string}:mcp` | `${string}:devin-tools` | `${string}:mcp-bridge`;

type DevinCliStatus = {
  executable: string;
  version: string | null;
  authenticated: boolean;
  acp: boolean;
  models: string[];
  hostCount: number;
  hosts: Array<{ model: string; status: 'starting' | 'online' | 'error' | 'offline'; processEpoch?: string }>;
};

type DevinNativeToolsPolicy = {
  filesystem: boolean;
  web: boolean;
  terminal: boolean;
  source: 'settings' | 'default';
};

type DevinCliSettings = {
  mcpBridge: { enabled: boolean; configuredBy: 'settings' | 'environment' | 'none'; transport: 'streamable-http'; url: string };
  nativeTools: DevinNativeToolsPolicy;
};

export function NativeCliIntegrationsPanel() {
  const [integrations, setIntegrations] = useState<NativeCliIntegrationStatus[]>([]);
  const [loading, setLoading] = useState(false);
  const [action, setAction] = useState<IntegrationAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [devinCli, setDevinCli] = useState<DevinCliStatus | null>(null);
  const [devinSettings, setDevinSettings] = useState<DevinCliSettings | null>(null);
  const [devinTokenOverride, setDevinTokenOverride] = useState('');

  const loadIntegrations = useCallback(async (): Promise<NativeCliIntegrationStatus[]> => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/runtime/native-cli-integrations');
      if (!response.ok) throw new Error(`${response.status}: ${response.statusText}`);
      const loaded = await response.json() as NativeCliIntegrationStatus[];
      setIntegrations(loaded);
      return loaded;
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load native CLI integrations.');
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDevinCliStatus = useCallback(async (): Promise<DevinCliStatus | null> => {
    try {
      const response = await fetch('/api/runtime/devin-cli/status');
      if (!response.ok) throw new Error(`${response.status}: ${response.statusText}`);
      const loaded = await response.json() as DevinCliStatus;
      setDevinCli(loaded);
      return loaded;
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load Devin CLI status.');
      return null;
    }
  }, []);

  const loadDevinCliSettings = useCallback(async (): Promise<DevinCliSettings | null> => {
    try {
      const response = await fetch('/api/runtime/devin-cli/settings');
      if (!response.ok) throw new Error(`${response.status}: ${response.statusText}`);
      const loaded = await response.json() as DevinCliSettings;
      setDevinSettings(loaded);
      return loaded;
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load Devin CLI settings.');
      return null;
    }
  }, []);

  const runAction = useCallback(async (integration: NativeCliIntegrationStatus, kind: 'check' | 'reset') => {
    if (kind === 'reset' && !window.confirm(`Reset the ${integration.displayName} server? Open native sessions will be disconnected.`)) {
      return;
    }

    const actionId = `${integration.authProfileId}:${kind}` as IntegrationAction;
    setAction(actionId);
    setError(null);
    if (kind === 'check') {
      setIntegrations((current) => current.map((item) => (
        item.authProfileId === integration.authProfileId
          ? { ...item, status: 'starting', connected: false }
          : item
      )));
    }
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
      const message = err instanceof Error ? err.message : `Failed to ${kind} native CLI integration.`;
      setError(message);
      if (kind === 'check') {
        setIntegrations((current) => current.map((item) => (
          item.authProfileId === integration.authProfileId
            ? { ...item, status: 'error', connected: false, lastError: message }
            : item
        )));
      }
    } finally {
      setAction(null);
    }
  }, []);

  const refreshStatus = useCallback(async () => {
    const [loaded] = await Promise.all([loadIntegrations(), loadDevinCliStatus(), loadDevinCliSettings()]);
    for (const integration of loaded) {
      await runAction(integration, 'check');
    }
  }, [loadDevinCliSettings, loadDevinCliStatus, loadIntegrations, runAction]);

  useEffect(() => {
    void refreshStatus();
    const intervalId = window.setInterval(() => void refreshStatus(), 30_000);
    return () => window.clearInterval(intervalId);
  }, [refreshStatus]);

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
      await refreshStatus();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to update Codex MCP policy.');
    } finally {
      setAction(null);
    }
  };

  const updateDevinNativeTool = async (category: keyof DevinNativeToolsPolicy, enabled: boolean) => {
    const actionId = `devin:${category}:devin-tools` as IntegrationAction;
    setAction(actionId);
    setError(null);
    try {
      const response = await fetch('/api/runtime/devin-cli/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [category]: enabled }),
      });
      if (!response.ok) {
        const body = await response.json().catch((err: unknown) => {
          console.debug('[NativeCliIntegrationsPanel] Devin settings error response was not JSON', err);
          return null;
        }) as { message?: string } | null;
        throw new Error(body?.message ?? `${response.status}: ${response.statusText}`);
      }
      setDevinSettings(await response.json() as DevinCliSettings);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to update Devin native tool policy.');
    } finally {
      setAction(null);
    }
  };

  const updateDevinBridgeToken = async (payload: { mcpBridgeToken?: string; generateMcpBridgeToken?: boolean; clearMcpBridgeToken?: boolean }) => {
    const actionId = 'devin:mcp-bridge' as IntegrationAction;
    setAction(actionId);
    setError(null);
    try {
      const response = await fetch('/api/runtime/devin-cli/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const body = await response.json().catch((err: unknown) => {
          console.debug('[NativeCliIntegrationsPanel] Devin bridge token response was not JSON', err);
          return null;
        }) as { message?: string } | null;
        throw new Error(body?.message ?? `${response.status}: ${response.statusText}`);
      }
      setDevinSettings(await response.json() as DevinCliSettings);
      setDevinTokenOverride('');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to update the Devin MCP bridge token.');
    } finally {
      setAction(null);
    }
  };

  return (
    <section className="flex flex-col gap-4" aria-labelledby="native-app-servers-title">
      <div className="flex items-center justify-between gap-4">
        <h3 id="native-app-servers-title" className="text-base font-semibold">Native runtimes</h3>
        <button
          type="button"
          className="btn btn-xs btn-ghost gap-1"
          disabled={loading}
          onClick={() => void refreshStatus()}
          title="Refresh integration status"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {error && <div className="alert alert-error text-sm" role="alert">{error}</div>}

      <DevinCliCard
        status={devinCli}
        settings={devinSettings}
        loading={loading && devinCli === null}
        onRefresh={() => { void loadDevinCliStatus(); void loadDevinCliSettings(); }}
        onUpdateNativeTool={(category, enabled) => void updateDevinNativeTool(category, enabled)}
        tokenOverride={devinTokenOverride}
        onTokenOverrideChange={setDevinTokenOverride}
        onUpdateBridgeToken={(payload) => void updateDevinBridgeToken(payload)}
        updating={action?.endsWith(':devin-tools') ?? false}
        bridgeUpdating={action === 'devin:mcp-bridge'}
      />

      {loading && integrations.length === 0 ? (
        <div className="flex items-center gap-2 text-sm text-base-content/50">
          <Loader2 size={14} className="animate-spin" />
          Checking native runtimes...
        </div>
      ) : integrations.length === 0 ? (
        <div className="rounded-lg border border-base-300 px-4 py-5 text-sm text-base-content/60">
          No native runtimes are configured yet.
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {integrations.map((integration) => {
            const checkAction = `${integration.authProfileId}:check` as IntegrationAction;
            const resetAction = `${integration.authProfileId}:reset` as IntegrationAction;
            return (
              <article key={integration.id} className="overflow-hidden rounded-xl border border-base-300">
                <div className="flex items-center gap-3 bg-base-200/40 px-4 py-3">
                  <ServerCog size={17} className="shrink-0 text-base-content/55" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold">{friendlyIntegrationName(integration)}</div>
                    <div className="mt-0.5 text-[11px] text-base-content/45">
                      {integration.openSessionCount} {integration.openSessionCount === 1 ? 'session' : 'sessions'} · {integration.connected ? 'Connected' : 'Disconnected'}
                    </div>
                  </div>
                  <StatusBadge status={integration.status} />
                </div>

                <div className="flex flex-col gap-3 px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-base-content/60">
                    <span className="rounded-md bg-base-200/70 px-2 py-1">
                      {integration.openSessionCount} {integration.openSessionCount === 1 ? 'open session' : 'open sessions'}
                    </span>
                    <span className={`rounded-md px-2 py-1 ${integration.connected ? 'bg-success/10 text-success' : 'bg-base-200/70'}`}>
                      {integration.connected ? 'Connected' : 'Not connected'}
                    </span>
                    <details className="ml-auto">
                      <summary className="flex cursor-pointer list-none items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-base-content/50 hover:bg-base-200/70 hover:text-base-content/80">
                        Details
                        <ChevronDown size={12} className="transition-transform" />
                      </summary>
                      <div className="mt-2 rounded-lg border border-base-300/70 bg-base-200/25 p-3 text-[11px] text-base-content/60">
                        <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
                          <div><dt className="text-base-content/40">Models</dt><dd className="break-words">{integration.models.join(', ') || 'None'}</dd></div>
                          <div><dt className="text-base-content/40">Profiles</dt><dd className="break-words">{integration.profileIds.join(', ') || 'None'}</dd></div>
                          <div><dt className="text-base-content/40">Auth profile</dt><dd className="break-words">{integration.authProfileId}</dd></div>
                          <div><dt className="text-base-content/40">Process</dt><dd className="break-all font-mono">{integration.processEpoch ?? 'Not started'}</dd></div>
                        </dl>
                      </div>
                    </details>
                  </div>

                  {integration.provider === 'codex' && (
                    <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-base-300 bg-base-200/20 px-3 py-2.5" title="Allow external MCP servers configured in Codex for this integration.">
                      <span className="min-w-0">
                        <span className="block text-sm font-medium">External MCP servers</span>
                        <span className="mt-0.5 block text-xs text-base-content/50">
                          {integration.mcp.inheritConfiguredMcp ? 'Allowed' : 'Blocked'}
                        </span>
                      </span>
                      <input
                        type="checkbox"
                        className="toggle toggle-sm"
                        checked={integration.mcp.inheritConfiguredMcp}
                        disabled={action !== null}
                        onChange={(event) => void updateMcpPolicy(integration, event.target.checked)}
                        aria-label="Allow Codex profile MCP servers"
                      />
                    </label>
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
                      Recheck
                    </button>
                    {integration.provider === 'codex' && (
                      <button
                        type="button"
                        className="btn btn-xs btn-ghost gap-1 text-warning"
                        disabled={action !== null}
                        onClick={() => void runAction(integration, 'reset')}
                      >
                        {action === resetAction ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />}
                        Reset
                      </button>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

function DevinCliCard({
  status,
  settings,
  loading,
  onRefresh,
  onUpdateNativeTool,
  tokenOverride,
  onTokenOverrideChange,
  onUpdateBridgeToken,
  updating,
  bridgeUpdating,
}: {
  status: DevinCliStatus | null;
  settings: DevinCliSettings | null;
  loading: boolean;
  onRefresh: () => void;
  onUpdateNativeTool: (category: keyof DevinNativeToolsPolicy, enabled: boolean) => void;
  tokenOverride: string;
  onTokenOverrideChange: (value: string) => void;
  onUpdateBridgeToken: (payload: { mcpBridgeToken?: string; generateMcpBridgeToken?: boolean; clearMcpBridgeToken?: boolean }) => void;
  updating: boolean;
  bridgeUpdating: boolean;
}) {
  const online = status?.authenticated === true && status.acp === true;
  return (
    <article className="overflow-hidden rounded-xl border border-base-300" data-testid="devin-cli-integration-card">
      <div className="flex items-center gap-3 bg-base-200/40 px-4 py-3">
        <ServerCog size={17} className="shrink-0 text-base-content/55" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">Devin CLI (host)</div>
          <div className="mt-0.5 text-[11px] text-base-content/45">
            {status ? `${status.hostCount} ${status.hostCount === 1 ? 'model host' : 'model hosts'} · ${status.executable}` : 'Local executable and ACP status'}
          </div>
        </div>
        <span className={`inline-flex items-center gap-1 text-xs ${loading ? 'text-warning' : online ? 'text-success' : 'text-error'}`}>
          {loading ? <Loader2 size={12} className="animate-spin" /> : online ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
          {loading ? 'Checking' : online ? 'Online' : 'Unavailable'}
        </span>
      </div>
      <div className="flex flex-col gap-3 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2 text-xs text-base-content/60">
          <span className={`rounded-md px-2 py-1 ${online ? 'bg-success/10 text-success' : 'bg-base-200/70'}`}>
            {status?.authenticated ? 'Logged in' : 'Login unavailable'}
          </span>
          <span className={`rounded-md px-2 py-1 ${status?.acp ? 'bg-success/10 text-success' : 'bg-base-200/70'}`}>
            {status?.acp ? 'ACP available' : 'ACP unavailable'}
          </span>
          <span className="rounded-md bg-base-200/70 px-2 py-1">
            {status?.models.join(', ') || 'No configured free model lanes'}
          </span>
          <span className={`rounded-md px-2 py-1 ${settings?.mcpBridge.enabled ? 'bg-success/10 text-success' : 'bg-base-200/70'}`}>
            {settings?.mcpBridge.enabled ? 'Kalio MCP bridge enabled' : 'Kalio MCP bridge disabled'}
          </span>
          <span className="rounded-md bg-base-200/70 px-2 py-1">
            Token: {settings?.mcpBridge.configuredBy === 'settings' ? 'Settings' : settings?.mcpBridge.configuredBy === 'environment' ? 'environment fallback' : 'not configured'}
          </span>
        </div>
        <p className="text-xs text-base-content/50">
          Host-local Devin uses ACP. Kalio tools are forwarded through the local Streamable HTTP bridge and remain scoped to the current session. Native provider tools stay blocked until enabled below and still pass through Kalio approval. Token actions and switches reset active Devin hosts.
        </p>
        <div className="rounded-lg border border-base-300 bg-base-200/20 p-3">
          <div className="mb-2 text-sm font-medium">Kalio MCP bridge token</div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              type="password"
              className="input input-bordered input-sm min-w-0 flex-1 font-mono"
              value={tokenOverride}
              onChange={(event) => onTokenOverrideChange(event.target.value)}
              placeholder="Override token (16+ characters)"
              aria-label="Kalio MCP bridge token override"
              disabled={bridgeUpdating}
            />
            <button
              type="button"
              className="btn btn-sm btn-outline"
              disabled={bridgeUpdating || tokenOverride.trim().length < 16}
              onClick={() => onUpdateBridgeToken({ mcpBridgeToken: tokenOverride })}
            >
              Save override
            </button>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              className="btn btn-xs btn-primary"
              disabled={bridgeUpdating}
              onClick={() => onUpdateBridgeToken({ generateMcpBridgeToken: true })}
            >
              Generate local token
            </button>
            <button
              type="button"
              className="btn btn-xs btn-ghost"
              disabled={bridgeUpdating || settings?.mcpBridge.configuredBy !== 'settings'}
              onClick={() => onUpdateBridgeToken({ clearMcpBridgeToken: true })}
            >
              Use environment fallback
            </button>
          </div>
          <p className="mt-2 text-[11px] text-base-content/45">
            The token is stored locally and never returned by the status endpoint. Clearing the override reveals the environment value, if configured.
          </p>
        </div>
        {settings && (
          <div className="grid gap-2 sm:grid-cols-3" aria-label="Devin native tools">
            {(['filesystem', 'web', 'terminal'] as const).map((category) => (
              <label key={category} className="flex cursor-pointer items-center justify-between gap-2 rounded-lg border border-base-300 bg-base-200/20 px-3 py-2" title={`Allow Devin ${category} tools.`}>
                <span className="text-sm font-medium capitalize">{category}</span>
                <input
                  type="checkbox"
                  className="toggle toggle-sm"
                  checked={settings.nativeTools[category]}
                  disabled={updating}
                  onChange={(event) => onUpdateNativeTool(category, event.target.checked)}
                  aria-label={`Allow Devin ${category} tools`}
                />
              </label>
            ))}
          </div>
        )}
        <details>
          <summary className="flex cursor-pointer list-none items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-base-content/50 hover:bg-base-200/70 hover:text-base-content/80">
            Details <ChevronDown size={12} />
          </summary>
          <div className="mt-2 rounded-lg border border-base-300/70 bg-base-200/25 p-3 text-[11px] text-base-content/60">
            <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
              <div><dt className="text-base-content/40">Version</dt><dd>{status?.version ?? 'Unknown'}</dd></div>
              <div><dt className="text-base-content/40">Executable</dt><dd className="break-all font-mono">{status?.executable ?? 'Unknown'}</dd></div>
              <div><dt className="text-base-content/40">Active hosts</dt><dd>{status?.hosts.map((host) => `${host.model}: ${host.status}`).join(', ') || 'None'}</dd></div>
            </dl>
          </div>
        </details>
        <div>
          <button type="button" className="btn btn-xs btn-primary gap-1" disabled={loading} onClick={onRefresh}>
            {loading ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
            Recheck
          </button>
        </div>
      </div>
    </article>
  );
}

function friendlyIntegrationName(integration: NativeCliIntegrationStatus): string {
  if (integration.provider.toLowerCase() === 'codex') {
    return 'Codex';
  }
  if (integration.provider.toLowerCase() === 'claude') {
    return 'Claude';
  }
  return integration.displayName.replace(/\s*\([^)]*\)\s*$/, '') || integration.provider;
}

function StatusBadge({ status }: { status: NativeCliIntegrationStatus['status'] }) {
  const online = status === 'online';
  const starting = status === 'starting';
  return (
    <span className={`inline-flex items-center gap-1 text-xs ${online ? 'text-success' : starting ? 'text-warning' : 'text-error'}`}>
      {online ? <CheckCircle2 size={12} /> : starting ? <Loader2 size={12} className="animate-spin" /> : <XCircle size={12} />}
       {online ? 'Online' : starting ? 'Checking' : status === 'error' ? 'Error' : 'Not started'}
    </span>
  );
}
