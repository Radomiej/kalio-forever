import { CheckCircle2, ChevronDown, Loader2, ServerCog, XCircle } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { DevinCliStatus } from '../../services/apiClient';

export type DevinNativeToolsPolicy = {
  filesystem: boolean;
  web: boolean;
  terminal: boolean;
  source: 'settings' | 'default';
};

export type DevinCliSettings = {
  mcpBridge: { enabled: boolean; configuredBy: 'settings' | 'environment' | 'none'; transport: 'streamable-http'; url: string };
  nativeTools: DevinNativeToolsPolicy;
};

interface Props {
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
}

export function DevinCliIntegrationCard({
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
}: Props) {
  const [modelDialogOpen, setModelDialogOpen] = useState(false);
  const [modelSearch, setModelSearch] = useState('');
  const probeChecked = status?.probeChecked === true;
  const online = probeChecked && status?.authenticated === true && status?.acp === true;
  const modelCount = status?.models.length ?? 0;
  const filteredModels = useMemo(() => {
    const query = modelSearch.trim().toLowerCase();
    return (status?.models ?? []).filter((model) => !query || model.toLowerCase().includes(query));
  }, [modelSearch, status?.models]);
  const catalogLabel = !probeChecked
    ? 'not checked'
    : status?.modelCatalogStatus === 'ready' && !status?.modelCatalogStale
      ? `${modelCount} discovered`
      : status?.modelCatalogStale
        ? 'stale catalog'
        : status?.modelCatalogStatus ?? 'not-checked';
  const statusClass = loading
    ? 'text-warning'
    : !probeChecked
      ? 'text-base-content/50'
      : online
        ? 'text-success'
        : 'text-error';

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
        <span className={`inline-flex items-center gap-1 text-xs ${statusClass}`}>
          {loading ? <Loader2 size={12} className="animate-spin" /> : !probeChecked ? <ServerCog size={12} /> : online ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
          {loading ? 'Checking' : !probeChecked ? 'Not checked' : online ? 'Online' : 'Unavailable'}
        </span>
      </div>
      <div className="flex flex-col gap-3 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2 text-xs text-base-content/60">
          <span className={`rounded-md px-2 py-1 ${online ? 'bg-success/10 text-success' : 'bg-base-200/70'}`}>
            {!probeChecked ? 'Login not checked' : status?.authenticated ? 'Logged in' : 'Login unavailable'}
          </span>
          <span className={`rounded-md px-2 py-1 ${online ? 'bg-success/10 text-success' : 'bg-base-200/70'}`}>
            {!probeChecked ? 'ACP not checked' : status?.acp ? 'ACP available' : 'ACP unavailable'}
          </span>
          <span className="rounded-md bg-base-200/70 px-2 py-1" data-testid="devin-model-catalog-status">
            {`Models: ${catalogLabel}`}
          </span>
          {modelCount > 0 ? (
            <button
              type="button"
              className="btn btn-xs btn-outline"
              onClick={() => setModelDialogOpen(true)}
              aria-haspopup="dialog"
              data-testid="devin-model-catalog-open"
            >
              Browse {modelCount} models
            </button>
          ) : (
            <span className="rounded-md bg-base-200/70 px-2 py-1">
              {probeChecked ? 'No models discovered' : 'Catalog not checked'}
            </span>
          )}
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
              <div><dt className="text-base-content/40">Version</dt><dd>{!probeChecked ? 'Not checked' : status.version ?? 'Unknown'}</dd></div>
              <div><dt className="text-base-content/40">Executable</dt><dd className="break-all font-mono">{status?.executable ?? 'Unknown'}</dd></div>
              <div><dt className="text-base-content/40">Active hosts</dt><dd>{status?.hosts.map((host) => `${host.model}: ${host.status}`).join(', ') || 'None'}</dd></div>
            </dl>
          </div>
        </details>
        <div>
          <button type="button" className="btn btn-xs btn-primary gap-1" disabled={loading || updating || bridgeUpdating} onClick={onRefresh}>
            {loading ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
            Recheck
          </button>
        </div>
      </div>
      {modelDialogOpen && (
        <div className="modal modal-open" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setModelDialogOpen(false);
        }}>
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="devin-model-catalog-title"
            className="modal-box max-w-2xl"
            data-testid="devin-model-catalog-dialog"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 id="devin-model-catalog-title" className="text-lg font-semibold">Devin models</h2>
                <p className="mt-1 text-xs text-base-content/60">{modelCount} models discovered from the connected Devin CLI.</p>
              </div>
              <button type="button" className="btn btn-sm btn-outline" onClick={() => setModelDialogOpen(false)}>Close</button>
            </div>
            <label className="form-control mt-4 gap-1">
              <span className="text-xs text-base-content/65">Search models</span>
              <input
                autoFocus
                type="search"
                className="input input-bordered input-sm font-mono"
                value={modelSearch}
                onChange={(event) => setModelSearch(event.target.value)}
                aria-label="Search Devin models"
              />
            </label>
            <ul className="mt-3 max-h-80 overflow-auto rounded-lg border border-base-300" aria-label="Discovered Devin models">
              {filteredModels.length > 0 ? filteredModels.map((model) => (
                <li key={model} className="border-b border-base-300/70 px-3 py-2 font-mono text-xs last:border-b-0">{model}</li>
              )) : <li className="px-3 py-4 text-sm text-base-content/55">No models match this search.</li>}
            </ul>
          </section>
        </div>
      )}
    </article>
  );
}
