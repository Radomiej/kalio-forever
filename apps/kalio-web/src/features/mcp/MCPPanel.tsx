import { useEffect, useState } from 'react';
import { apiClient } from '../../services/apiClient';
import type { MCPServer } from '@kalio/types';

export function MCPPanel() {
  const [servers, setServers] = useState<MCPServer[]>([]);
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');

  useEffect(() => {
    apiClient
      .get<MCPServer[]>('/api/mcp/servers')
      .then((r) => setServers(r.data))
      .catch((err: unknown) => console.error('[MCPPanel] load failed', err));
  }, []);

  const addServer = async () => {
    if (!url || !name) return;
    try {
      const { data } = await apiClient.post<MCPServer>('/api/mcp/servers', { name, url });
      setServers((prev) => [...prev, data]);
      setUrl('');
      setName('');
    } catch (err) {
      console.error('[MCPPanel] add failed', err);
    }
  };

  return (
    <div data-testid="mcp-panel" className="flex flex-col gap-2 p-2">
      <div className="text-xs font-semibold">MCP Servers</div>
      <input data-testid="mcp-name" className="input input-bordered input-xs" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
      <input data-testid="mcp-url" className="input input-bordered input-xs" placeholder="URL" value={url} onChange={(e) => setUrl(e.target.value)} />
      <button data-testid="mcp-add" className="btn btn-primary btn-xs" onClick={addServer}>Add</button>
      {servers.map((s) => (
        <div key={s.id} data-testid="mcp-server-item" className="rounded border border-base-300 p-2 text-xs">
          <div className="flex items-center justify-between">
            <span>{s.name}</span>
            <span className={`badge badge-xs ${s.status === 'connected' ? 'badge-success' : s.status === 'error' ? 'badge-error' : 'badge-warning'}`}>
              {s.status}
            </span>
          </div>
          <div className="text-base-content/50">{s.url}</div>
        </div>
      ))}
    </div>
  );
}
