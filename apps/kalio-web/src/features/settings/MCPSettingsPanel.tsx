import { useState, useEffect, useCallback } from 'react';
import { Plus, ChevronUp, RefreshCw, Container, Loader2, Wrench, AlertCircle } from 'lucide-react';
import type { MCPServer, CreateMCPServerDto } from '@kalio/types';
import { MCPServerRow } from './MCPServerRow';
import { MCPAddServerForm } from './MCPAddServerForm';

async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`${res.status}: ${text}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

const DOCKER_GATEWAY_NAME = 'Docker MCP Gateway';

export function MCPSettingsPanel() {
  const [servers, setServers] = useState<MCPServer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [addingGateway, setAddingGateway] = useState(false);

  const load = useCallback(async () => {
    try {
      const list = await apiFetch<MCPServer[]>('/mcp/servers');
      setServers(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load servers');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const interval = setInterval(() => { void load(); }, 5000);
    return () => clearInterval(interval);
  }, [load]);

  const handleAdd = async (dto: CreateMCPServerDto) => {
    const created = await apiFetch<MCPServer>('/mcp/servers', {
      method: 'POST',
      body: JSON.stringify(dto),
    });
    setServers((prev) => [...prev, created]);
    setShowForm(false);
  };

  const handleRestart = async (id: string) => {
    await apiFetch(`/mcp/servers/${id}/restart`, { method: 'POST' });
    await load();
  };

  const handleRemove = async (id: string) => {
    await apiFetch(`/mcp/servers/${id}`, { method: 'DELETE' });
    setServers((prev) => prev.filter((s) => s.id !== id));
  };

  const handleDockerGateway = async () => {
    const existing = servers.find((s) => s.name === DOCKER_GATEWAY_NAME);
    if (existing) return;
    setAddingGateway(true);
    try {
      await handleAdd({
        name: DOCKER_GATEWAY_NAME,
        transport: 'stdio',
        command: 'docker',
        args: ['mcp', 'gateway', 'run'],
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add Docker MCP Gateway');
    } finally {
      setAddingGateway(false);
    }
  };

  const connectedCount = servers.filter((s) => s.status === 'connected').length;
  const totalTools = servers.reduce((n, s) => n + (s.toolCount ?? 0), 0);
  const gatewayConnected = servers.some((s) => s.name === DOCKER_GATEWAY_NAME);

  return (
    <div className="flex flex-col gap-5" data-testid="mcp-panel">
      <div>
        <h2 className="text-base font-semibold mb-1">MCP Servers</h2>
        <p className="text-xs text-base-content/60">
          Model Context Protocol servers extend the AI with external tools.
        </p>
      </div>

      {error && (
        <div className="alert alert-warning py-2 text-xs gap-2">
          <AlertCircle size={14} />
          {error}
          <button className="btn btn-ghost btn-xs ml-auto" onClick={() => setError(null)}>✕</button>
        </div>
      )}

      {/* Status summary */}
      <div className="flex gap-3">
        <div className="stat bg-base-200/40 rounded-lg p-3 flex-1">
          <div className="stat-title text-xs">Connected</div>
          <div className="stat-value text-lg">{connectedCount}/{servers.length}</div>
        </div>
        <div className="stat bg-base-200/40 rounded-lg p-3 flex-1">
          <div className="stat-title text-xs">Tools Available</div>
          <div className="stat-value text-lg flex items-center gap-1">
            <Wrench size={16} className="text-base-content/50" /> {totalTools}
          </div>
        </div>
      </div>

      {/* Docker MCP Gateway quick-connect */}
      {!gatewayConnected && (
        <div className="flex items-center justify-between px-3 py-2 rounded-lg border border-base-300 bg-base-200/40">
          <div className="flex items-center gap-2 min-w-0">
            <Container size={14} className="text-sky-400 shrink-0" />
            <div className="min-w-0">
              <p className="text-xs font-medium">Docker MCP Gateway</p>
              <p className="text-[10px] text-base-content/50 truncate">Requires Docker Desktop with MCP Toolkit</p>
            </div>
          </div>
          <button
            className="btn btn-sm btn-outline gap-1 shrink-0"
            onClick={() => void handleDockerGateway()}
            disabled={addingGateway}
            data-testid="mcp-docker-gateway-btn"
          >
            {addingGateway ? <Loader2 size={12} className="animate-spin" /> : <Container size={12} />}
            Connect
          </button>
        </div>
      )}

      {/* Server list */}
      {loading ? (
        <div className="flex items-center gap-2 text-xs text-base-content/50 py-2">
          <Loader2 size={14} className="animate-spin" /> Loading servers…
        </div>
      ) : servers.length === 0 ? (
        <p className="text-sm text-base-content/40 italic py-2" data-testid="mcp-empty">
          No servers connected yet.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {servers.map((s) => (
            <MCPServerRow
              key={s.id}
              server={s}
              onRestart={handleRestart}
              onRemove={handleRemove}
            />
          ))}
        </div>
      )}

      {/* Add server toggle */}
      <div>
        <button
          className="btn btn-outline btn-sm gap-2 w-full"
          onClick={() => setShowForm((v) => !v)}
          data-testid="mcp-add-toggle"
        >
          {showForm ? <ChevronUp size={14} /> : <Plus size={14} />}
          {showForm ? 'Cancel' : 'Add Server'}
        </button>

        {showForm && (
          <div className="mt-3">
            <MCPAddServerForm
              onSubmit={handleAdd}
              onCancel={() => setShowForm(false)}
            />
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 text-xs text-base-content/40">
        <RefreshCw size={11} />
        <span>Server list refreshes automatically every 5 seconds.</span>
      </div>
    </div>
  );
}

