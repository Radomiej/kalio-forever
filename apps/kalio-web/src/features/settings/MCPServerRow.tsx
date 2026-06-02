import { useState } from 'react';
import { RefreshCw, Trash2, Loader2, AlertCircle, Wrench } from 'lucide-react';
import type { MCPServer } from '@kalio/types';

type SettingsMCPServer = MCPServer & { managedBy?: 'toml' };

interface Props {
  server: SettingsMCPServer;
  onRestart: (id: string) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
}

const STATUS_CLASSES: Record<string, string> = {
  connected:    'badge-success',
  connecting:   'badge-warning',
  disconnected: 'badge-neutral',
  error:        'badge-error',
  stopped:      'badge-neutral',
};

export function MCPServerRow({ server, onRestart, onRemove }: Props) {
  const [restarting, setRestarting] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const isTomlManaged = server.managedBy === 'toml';

  const handleRestart = async () => {
    if (isTomlManaged) return;
    setRestarting(true);
    try { await onRestart(server.id); } finally { setRestarting(false); }
  };

  const handleRemove = async () => {
    if (isTomlManaged) return;
    setRemoving(true);
    try { await onRemove(server.id); } finally { setRemoving(false); setConfirmRemove(false); }
  };

  const statusClass = STATUS_CLASSES[server.status] ?? 'badge-neutral';

  return (
    <div
      className="flex flex-col gap-1 px-3 py-2 rounded-lg border border-base-300 bg-base-200/40"
      data-testid={`mcp-server-${server.id}`}
    >
      <div className="flex items-center gap-2">
        <span className={`badge badge-xs font-mono ${statusClass}`}>{server.status}</span>
        <span className="font-medium text-sm flex-1 truncate">{server.name}</span>
        {isTomlManaged && (
          <span className="badge badge-xs border-sky-500/30 bg-sky-500/10 text-sky-300" data-testid={`mcp-managed-${server.id}`}>
            TOML
          </span>
        )}
        <span className="text-xs text-base-content/40 font-mono">{server.transport}</span>
        {(server.toolCount ?? 0) > 0 && (
          <span className="flex items-center gap-1 text-xs text-base-content/50">
            <Wrench size={11} /> {server.toolCount}
          </span>
        )}

        {/* Restart */}
        <button
          className="btn btn-ghost btn-xs"
          onClick={() => void handleRestart()}
          disabled={restarting || removing || isTomlManaged}
          title={isTomlManaged ? 'Reload TOML config to reconnect this server' : 'Restart'}
          data-testid={`mcp-restart-${server.id}`}
        >
          <RefreshCw size={12} className={restarting ? 'animate-spin' : ''} />
        </button>

        {/* Remove */}
        {confirmRemove ? (
          <div className="flex items-center gap-1">
            <span className="text-xs text-warning">Remove?</span>
            <button
              className="btn btn-xs btn-error"
              onClick={() => void handleRemove()}
              disabled={removing}
              data-testid={`mcp-remove-confirm-${server.id}`}
            >
              {removing ? <Loader2 size={11} className="animate-spin" /> : 'Yes'}
            </button>
            <button className="btn btn-xs btn-ghost" onClick={() => setConfirmRemove(false)}>No</button>
          </div>
        ) : (
          <button
            className="btn btn-ghost btn-xs text-error/70 hover:text-error"
            onClick={() => setConfirmRemove(true)}
            disabled={removing || isTomlManaged}
            title={isTomlManaged ? 'TOML-managed servers are removed from config.toml' : 'Remove'}
            data-testid={`mcp-remove-${server.id}`}
          >
            <Trash2 size={12} />
          </button>
        )}
      </div>

      {server.lastError && server.status === 'error' && (
        <div className="flex items-center gap-1 text-xs text-error/80 pl-1">
          <AlertCircle size={11} />
          <span className="truncate">{server.lastError}</span>
        </div>
      )}
    </div>
  );
}
