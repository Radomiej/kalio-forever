import { useEffect, useState, useCallback } from 'react';
import { RefreshCw, ChevronDown, ChevronRight, Wrench, Settings, AlertCircle } from 'lucide-react';
import { apiClient } from '../../services/apiClient';
import type { MCPServer, MCPTool } from '@kalio/types';

interface MCPPanelProps {
  onOpenSettings: () => void;
}

/** Strip the `mcp_{serverId}_` prefix that the backend adds to tool names. */
function cleanToolName(toolName: string, serverId: string): string {
  const prefix = `mcp_${serverId}_`;
  if (toolName.startsWith(prefix)) return toolName.slice(prefix.length);
  // Also handle :: namespace format (legacy)
  const colonIdx = toolName.lastIndexOf('::');
  if (colonIdx !== -1) return toolName.slice(colonIdx + 2);
  return toolName;
}

const STATUS_DOT: Record<string, string> = {
  connected:    'bg-success',
  connecting:   'bg-warning animate-pulse',
  disconnected: 'bg-neutral',
  error:        'bg-error',
  stopped:      'bg-neutral',
};

interface ServerRowProps {
  server: MCPServer;
  onRestart: (id: string) => void;
}

function ServerRow({ server, onRestart }: ServerRowProps) {
  const [open, setOpen] = useState(false);
  const [tools, setTools] = useState<MCPTool[]>([]);
  const [loadingTools, setLoadingTools] = useState(false);
  const [restarting, setRestarting] = useState(false);

  const loadTools = useCallback(() => {
    setLoadingTools(true);
    apiClient
      .get<MCPTool[]>('/api/mcp/tools')
      .then((r) => setTools(r.data.filter((t) => t.serverId === server.id)))
      .catch(() => setTools([]))
      .finally(() => setLoadingTools(false));
  }, [server.id]);

  const toggle = () => {
    setOpen((v) => {
      if (!v && tools.length === 0) loadTools();
      return !v;
    });
  };

  const handleRestart = async () => {
    setRestarting(true);
    try {
      await apiClient.post(`/api/mcp/servers/${server.id}/restart`);
      onRestart(server.id);
    } catch (err) {
      console.error('[MCPPanel] restart failed', err instanceof Error ? err.message : err);
    } finally {
      setRestarting(false);
    }
  };

  const dotClass = STATUS_DOT[server.status] ?? 'bg-neutral';

  return (
    <div className="border border-base-300 rounded overflow-hidden text-xs">
      {/* Header row */}
      <div className="flex items-center gap-2 px-2 py-2 bg-base-200/60">
        <button onClick={toggle} className="flex items-center gap-1.5 flex-1 min-w-0 text-left">
          <span className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${dotClass}`} />
          {open ? <ChevronDown size={11} className="shrink-0" /> : <ChevronRight size={11} className="shrink-0" />}
          <span className="font-medium truncate">{server.name}</span>
          {server.toolCount != null && server.toolCount > 0 && (
            <span className="text-base-content/40 shrink-0 flex items-center gap-0.5">
              <Wrench size={9} /> {server.toolCount}
            </span>
          )}
        </button>
        <button
          className="btn btn-ghost btn-xs shrink-0"
          onClick={() => void handleRestart()}
          disabled={restarting}
          title="Restart"
          data-testid="mcp-restart"
        >
          <RefreshCw size={11} className={restarting ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Connection info / error */}
      {(server.url ?? server.command) && (
        <div className="px-2 py-0.5 text-base-content/30 font-mono text-[10px] bg-base-100/50 truncate">
          {server.url ?? server.command}
        </div>
      )}
      {server.lastError && server.status === 'error' && (
        <div className="flex items-center gap-1 px-2 py-1 text-error text-[10px]">
          <AlertCircle size={10} className="shrink-0" />
          <span className="truncate">{server.lastError}</span>
        </div>
      )}

      {/* Expandable tool list */}
      {open && (
        <div className="px-2 py-2 border-t border-base-300 space-y-1 bg-base-100">
          {loadingTools && <p className="text-base-content/40 text-[10px]">Loading tools…</p>}
          {!loadingTools && tools.length === 0 && (
            <p className="text-base-content/40 text-[10px]">No tools exposed.</p>
          )}
          {tools.map((t) => {
            const displayName = cleanToolName(t.name, server.id);
            return (
              <div key={t.name} className="flex items-start gap-1.5">
                <Wrench size={9} className="mt-0.5 text-base-content/30 shrink-0" />
                <div className="min-w-0">
                  <span className="font-mono text-[10px] text-primary">{displayName}</span>
                  {t.description && (
                    <p className="text-base-content/40 text-[10px] leading-tight">{t.description}</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function MCPPanel({ onOpenSettings }: MCPPanelProps) {
  const [servers, setServers] = useState<MCPServer[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    apiClient
      .get<MCPServer[]>('/api/mcp/servers')
      .then((r) => setServers([...new Map(r.data.map((s) => [s.id, s])).values()]))
      .catch((err: unknown) => console.error('[MCPPanel] load failed', err))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 8000);
    return () => clearInterval(interval);
  }, [load]);

  const totalTools = servers.reduce((n, s) => n + (s.toolCount ?? 0), 0);

  return (
    <div data-testid="mcp-panel" className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-base-300 shrink-0">
        <span className="text-xs text-base-content/50">
          {servers.length} server{servers.length !== 1 ? 's' : ''}
          {totalTools > 0 && ` · ${totalTools} tools`}
        </span>
        <div className="flex items-center gap-1">
          <button
            className="btn btn-ghost btn-xs"
            onClick={load}
            disabled={loading}
            title="Refresh"
          >
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          </button>
          <button
            className="btn btn-ghost btn-xs"
            onClick={onOpenSettings}
            title="Configure MCP servers in Settings"
            data-testid="mcp-open-settings"
          >
            <Settings size={12} />
          </button>
        </div>
      </div>

      {/* Server list */}
      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {loading && servers.length === 0 && (
          <div className="flex items-center justify-center h-16 text-base-content/30 text-xs">
            Loading…
          </div>
        )}
        {!loading && servers.length === 0 && (
          <div className="flex flex-col items-center justify-center h-24 gap-2 text-center px-4">
            <p className="text-xs text-base-content/40">No MCP servers configured.</p>
            <button
              className="btn btn-outline btn-xs gap-1"
              onClick={onOpenSettings}
            >
              <Settings size={11} /> Configure in Settings
            </button>
          </div>
        )}
        {servers.map((s) => (
          <ServerRow key={s.id} server={s} onRestart={load} />
        ))}
      </div>
    </div>
  );
}
