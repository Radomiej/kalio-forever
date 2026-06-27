import { useEffect, useMemo, useState } from 'react';
import { Loader2, FolderInput } from 'lucide-react';

interface ExternalMCPServerEntry {
  id: string;
  source: 'cursor' | 'windsurf' | 'codex' | 'copilot';
  configPath: string;
  key: string;
  serverKey?: string;
  store?: string;
  originSource?: string;
  effectiveState?: string;
  conflictGroup?: string | null;
  dto: {
    name: string;
    transport: 'stdio' | 'http';
    command?: string;
    url?: string;
    args?: string[];
  };
  details: {
    envKeys: string[];
    headerKeys: string[];
  };
  equivalentToExisting: boolean;
}

interface ExternalMCPImportResult {
  imported: Array<{ id: string; name: string }>;
  skipped: Array<{ id: string; reason: string }>;
  failed: Array<{ id: string; reason: string }>;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onImported: () => Promise<void>;
}

async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`${res.status}: ${text}`);
  }
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export function MCPExternalImportModal({ isOpen, onClose, onImported }: Props) {
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [entries, setEntries] = useState<ExternalMCPServerEntry[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [lastResult, setLastResult] = useState<ExternalMCPImportResult | null>(null);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    setError(null);
    setLastResult(null);
    setLoading(true);
    void apiFetch<ExternalMCPServerEntry[]>('/mcp/servers/import/external/discover', { method: 'POST' })
      .then((found) => {
        setEntries(found);
        setSelected(new Set());
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Failed to discover external MCP configs');
        setEntries([]);
        setSelected(new Set());
      })
      .finally(() => setLoading(false));
  }, [isOpen]);

  const selectedCount = selected.size;
  const canApply = selectedCount > 0 && !applying && !loading;

  const sortedEntries = useMemo(
    () => [...entries].sort((a, b) => Number(a.equivalentToExisting) - Number(b.equivalentToExisting)),
    [entries],
  );

  const toggleByIndex = (index: number) => {
    const entry = sortedEntries[index];
    if (!entry) {
      return;
    }
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(entry.id)) {
        next.delete(entry.id);
      } else {
        next.add(entry.id);
      }
      return next;
    });
  };

  const handleApply = async () => {
    if (!canApply) {
      return;
    }
    setApplying(true);
    setError(null);
    setLastResult(null);

    try {
      const result = await apiFetch<ExternalMCPImportResult>('/mcp/servers/import/external/apply', {
        method: 'POST',
        body: JSON.stringify({ entryIds: [...selected] }),
      });
      setLastResult(result);
      await onImported();
      if (result.failed.length === 0) {
        onClose();
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to import selected entries');
    } finally {
      setApplying(false);
    }
  };

  if (!isOpen) {
    return null;
  }

  return (
    <dialog className="modal modal-open" data-testid="mcp-external-import-modal">
      <div className="modal-box w-11/12 max-w-3xl">
        <h3 className="font-semibold text-base flex items-center gap-2">
          <FolderInput size={16} className="text-base-content/70" />
          <span>Import Existing MCP Configs</span>
        </h3>
        <p className="text-xs text-base-content/60 mt-1">
          Conservative mode: review detected configs and choose exactly what to import.
        </p>

        {error && <div className="alert alert-warning py-2 text-xs mt-3">{error}</div>}

        {loading ? (
          <div className="flex items-center gap-2 text-xs text-base-content/60 mt-4">
            <Loader2 size={14} className="animate-spin" />
            Scanning Cursor, Windsurf, Codex, and Copilot configs...
          </div>
        ) : (
          <div className="mt-4 max-h-[48vh] overflow-y-auto border border-base-300 rounded-lg divide-y divide-base-300/60">
            {sortedEntries.length === 0 && (
              <div className="p-3 text-sm text-base-content/50" data-testid="mcp-external-empty">
                No external MCP configs detected.
              </div>
            )}

            {sortedEntries.map((entry, index) => {
              const isChecked = selected.has(entry.id);
              return (
                <label
                  key={entry.id}
                  className="p-3 flex gap-3 cursor-pointer hover:bg-base-200/30"
                >
                  <input
                    type="checkbox"
                    className="checkbox checkbox-sm mt-1"
                    checked={isChecked}
                    onChange={() => toggleByIndex(index)}
                    data-testid={`mcp-external-check-${index}`}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{entry.dto.name}</span>
                      <span className="badge badge-ghost badge-xs uppercase">{entry.source}</span>
                      {entry.store && <span className="badge badge-ghost badge-xs uppercase">{entry.store}</span>}
                      {entry.equivalentToExisting && <span className="badge badge-warning badge-xs">Equivalent to existing</span>}
                    </div>
                    <p className="text-[11px] text-base-content/55 font-mono mt-1 break-all">{entry.configPath}</p>
                    <p className="text-[11px] text-base-content/70 mt-1">
                      {entry.dto.transport === 'http'
                        ? `HTTP: ${entry.dto.url ?? ''}`
                        : `stdio: ${entry.dto.command ?? ''} ${(entry.dto.args ?? []).join(' ')}`}
                    </p>
                    {(entry.serverKey || entry.effectiveState || entry.originSource || entry.key) && (
                      <p className="text-[11px] text-base-content/60 mt-1">
                        key: {entry.serverKey ?? entry.key}
                        {entry.effectiveState ? ` | state: ${entry.effectiveState}` : ''}
                        {entry.originSource ? ` | origin: ${entry.originSource}` : ''}
                      </p>
                    )}
                    {(entry.details.envKeys.length > 0 || entry.details.headerKeys.length > 0) && (
                      <p className="text-[11px] text-base-content/60 mt-1">
                        env: {entry.details.envKeys.join(', ') || '-'} | headers: {entry.details.headerKeys.join(', ') || '-'}
                      </p>
                    )}
                    {entry.equivalentToExisting && (
                      <p className="text-[11px] text-warning mt-1" data-testid={`mcp-external-duplicate-${index}`}>
                        Equivalent config already exists in Kalio. Selection is still allowed and imports as a separate SQLite entry.
                      </p>
                    )}
                  </div>
                </label>
              );
            })}
          </div>
        )}

        {lastResult && (
          <div className="mt-3 text-xs text-base-content/70" data-testid="mcp-external-result">
            Imported: {lastResult.imported.length} | Skipped: {lastResult.skipped.length} | Failed: {lastResult.failed.length}
          </div>
        )}

        <div className="modal-action">
          <button className="btn btn-ghost btn-sm" onClick={onClose} disabled={applying}>
            Close
          </button>
          <button
            className="btn btn-primary btn-sm gap-2"
            onClick={() => void handleApply()}
            disabled={!canApply}
            data-testid="mcp-external-apply-btn"
          >
            {applying && <Loader2 size={13} className="animate-spin" />}
            Import selected ({selectedCount})
          </button>
        </div>
      </div>
      <div className="modal-backdrop" onClick={onClose} />
    </dialog>
  );
}
