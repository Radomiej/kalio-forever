import { useEffect, useState } from 'react';
import { RefreshCw, Trash2, ChevronDown, ChevronRight, Wrench } from 'lucide-react';
import { apiClient } from '../../services/apiClient';
import type { MCPServer, MCPTool } from '@kalio/types';

function ServerRow({ server, onDelete, onRestart }: { server: MCPServer; onDelete: (id: string) => void; onRestart: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [tools, setTools] = useState<MCPTool[]>([]);
  const [loadingTools, setLoadingTools] = useState(false);
  const [restarting, setRestarting] = useState(false);

  const loadTools = () => {
    setLoadingTools(true);
    apiClient
      .get<MCPTool[]>('/api/mcp/tools', { params: { serverId: server.id } })
      .then((r) => setTools(r.data.filter((t) => t.serverId === server.id)))
      .catch(() => setTools([]))
      .finally(() => setLoadingTools(false));
  };

  const toggle = () => {
    setOpen((v) => !v);
    if (!open && tools.length === 0) loadTools();
  };

  const handleRestart = async () => {
    setRestarting(true);
    try {
      await apiClient.post(`/api/mcp/servers/${server.id}/restart`);
      onRestart(server.id);
    } catch (err) {
      console.error('[MCPPanel] restart failed', err);
    } finally {
      setRestarting(false);
    }
  };

  const statusColor = server.status === 'connected' ? 'badge-success' : server.status === 'error' ? 'badge-error' : 'badge-warning';

  return (
    <div className="rounded border border-base-300 overflow-hidden text-xs">
      <div className="flex items-center gap-2 px-2 py-2 bg-base-200">
        <button onClick={toggle} className="flex items-center gap-1 flex-1 min-w-0 text-left">
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          <span className="font-medium truncate">{server.name}</span>
          <span className={`badge badge-xs ${statusColor}`}>{server.status}</span>
          {server.toolCount != null && (
            <span className="text-base-content/40 ml-1">{server.toolCount} tools</span>
          )}
        </button>
        <div className="flex gap-1 shrink-0">
          <button
            className={`btn btn-xs btn-ghost ${restarting ? 'loading' : ''}`}
            onClick={handleRestart}
            title="Restart server"
            data-testid="mcp-restart"
          >
            {!restarting && <RefreshCw size={11} />}
          </button>
          <button
            className="btn btn-xs btn-ghost text-error"
            onClick={() => onDelete(server.id)}
            title="Delete server"
            data-testid="mcp-delete"
          >
            <Trash2 size={11} />
          </button>
        </div>
      </div>
      <div className="px-2 py-1 text-base-content/40 text-xs">{server.url ?? server.command}</div>
      {server.lastError && (
        <div className="px-2 pb-1 text-error text-xs truncate">{server.lastError}</div>
      )}
      {open && (
        <div className="px-2 py-2 border-t border-base-300 space-y-1 bg-base-100">
          {loadingTools && <p className="text-base-content/40">Loading tools…</p>}
          {!loadingTools && tools.length === 0 && <p className="text-base-content/40">No tools found.</p>}
          {tools.map((t) => (
            <div key={t.name} className="flex items-start gap-2">
              <Wrench size={10} className="mt-0.5 text-base-content/40 shrink-0" />
              <div>
                <span className="font-mono font-medium">{t.name.split('::').pop()}</span>
                {t.description && <p className="text-base-content/50">{t.description}</p>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function MCPPanel() {
  const [servers, setServers] = useState<MCPServer[]>([]);
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [transport, setTransport] = useState<'http' | 'stdio'>('http');
  const [command, setCommand] = useState('');

  const load = () => {
    apiClient
      .get<MCPServer[]>('/api/mcp/servers')
      .then((r) => setServers(r.data))
      .catch((err: unknown) => console.error('[MCPPanel] load failed', err));
  };

  useEffect(() => { load(); }, []);

  const addServer = async () => {
    const nameVal = name.trim();
    const urlVal = url.trim();
    const cmdVal = command.trim();
    if (!nameVal || (transport === 'http' && !urlVal) || (transport === 'stdio' && !cmdVal)) return;
    try {
      const payload = transport === 'http'
        ? { name: nameVal, transport, url: urlVal }
        : { name: nameVal, transport, command: cmdVal };
      const { data } = await apiClient.post<MCPServer>('/api/mcp/servers', payload);
      setServers((prev) => [...prev, data]);
      setUrl(''); setName(''); setCommand('');
    } catch (err) {
      console.error('[MCPPanel] add failed', err);
    }
  };

  const deleteServer = async (id: string) => {
    await apiClient.delete(`/api/mcp/servers/${id}`).catch(() => {});
    setServers((prev) => prev.filter((s) => s.id !== id));
  };

  return (
    <div data-testid="mcp-panel" className="flex flex-col gap-2 p-2">
      <div className="text-xs font-semibold">MCP Servers</div>

      <div className="flex gap-1 mb-1">
        <button
          className={`btn btn-xs flex-1 ${transport === 'http' ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => setTransport('http')}
        >HTTP</button>
        <button
          className={`btn btn-xs flex-1 ${transport === 'stdio' ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => setTransport('stdio')}
        >stdio</button>
      </div>

      <input data-testid="mcp-name" className="input input-bordered input-xs" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
      {transport === 'http' ? (
        <input data-testid="mcp-url" className="input input-bordered input-xs" placeholder="URL (http://...)" value={url} onChange={(e) => setUrl(e.target.value)} />
      ) : (
        <input data-testid="mcp-command" className="input input-bordered input-xs" placeholder="Command (e.g. npx mcp-server)" value={command} onChange={(e) => setCommand(e.target.value)} />
      )}
      <button data-testid="mcp-add" className="btn btn-primary btn-xs" onClick={addServer}>Add Server</button>

      <div className="space-y-2 mt-1">
        {servers.map((s) => (
          <ServerRow key={s.id} server={s} onDelete={deleteServer} onRestart={load} />
        ))}
        {servers.length === 0 && <p className="text-xs text-base-content/40">No MCP servers configured.</p>}
      </div>
    </div>
  );
}
