import { useState } from 'react';
import { RefreshCw, Trash2, Loader2, AlertCircle, Wrench } from 'lucide-react';
import type { SettingsMCPServerRow } from './MCPSettingsPanel.model';

interface Props {
  server: SettingsMCPServerRow;
  onRestart: (serverKey: string) => Promise<void>;
  onRemove: (serverKey: string) => Promise<void>;
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
  const stateLabel = server.effectiveState.replaceAll('-', ' ');
  const originLabel = server.originSource.replaceAll('-', ' ');
  const storeLabel = server.store.toUpperCase();
  const isShadowed = server.effectiveState === 'shadowed';
  const isConflicted = server.conflictGroup !== null;
  const canRemove = !server.readonly;

  const handleRestart = async () => {
    setRestarting(true);
    try { await onRestart(server.serverKey); } finally { setRestarting(false); }
  };

  const handleRemove = async () => {
    if (!canRemove) return;
    setRemoving(true);
    try { await onRemove(server.serverKey); } finally { setRemoving(false); setConfirmRemove(false); }
  };

  const statusClass = STATUS_CLASSES[server.status] ?? 'badge-neutral';

  return (
    <div
      className="flex flex-col gap-1 px-3 py-2 rounded-lg border border-base-300 bg-base-200/40"
      data-testid={`mcp-server-${server.testIdSuffix}`}
    >
      <div className="flex items-center gap-2">
        <span className={`badge badge-xs font-mono ${statusClass}`}>{server.status}</span>
        <span className="font-medium text-sm flex-1 truncate">{server.name}</span>
        <span
          className={`badge badge-xs ${server.store === 'toml' ? 'border-sky-500/30 bg-sky-500/10 text-sky-300' : 'badge-ghost'}`}
          data-testid={`mcp-store-${server.testIdSuffix}`}
        >
          {storeLabel}
        </span>
        {isShadowed ? (
          <span className="badge badge-xs badge-warning capitalize" title={`Effective state: ${server.effectiveState}`}>
            Shadowed
          </span>
        ) : (
          <span className="badge badge-xs badge-ghost capitalize" title={`Effective state: ${server.effectiveState}`}>
            {stateLabel}
          </span>
        )}
        {isConflicted && (
          <span className="badge badge-xs badge-outline" title={`Conflict group: ${server.conflictGroup}`}>
            Conflict
          </span>
        )}
        <span className="badge badge-xs badge-outline capitalize" title={`Origin: ${server.originSource}`}>
          {originLabel}
        </span>
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
          disabled={restarting || removing}
          title="Restart"
          data-testid={`mcp-restart-${server.testIdSuffix}`}
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
              data-testid={`mcp-remove-confirm-${server.testIdSuffix}`}
            >
              {removing ? <Loader2 size={11} className="animate-spin" /> : 'Yes'}
            </button>
            <button className="btn btn-xs btn-ghost" onClick={() => setConfirmRemove(false)}>No</button>
          </div>
        ) : (
          <button
            className="btn btn-ghost btn-xs text-error/70 hover:text-error"
            onClick={() => setConfirmRemove(true)}
            disabled={removing || !canRemove}
            title={canRemove ? 'Remove' : 'This row is managed by TOML; remove it from .kalio/config.toml instead.'}
            data-testid={`mcp-remove-${server.testIdSuffix}`}
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
