import { useEffect, useState, useCallback } from 'react';
import { RefreshCw, Search, Shield, ShieldOff, Wrench, X } from 'lucide-react';
import { apiClient } from '../../services/apiClient';
import type { ToolMeta } from '@kalio/types';
import { groupToolsByPrefix } from './tool.utils';

// ─── panel ────────────────────────────────────────────────────────────────────

export function ToolPanel() {
  const [tools, setTools] = useState<ToolMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await apiClient.get<ToolMeta[]>('/api/tools');
      setTools(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load tools');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const handleToggleConfirmation = useCallback(async (toolName: string, current: boolean) => {
    const updated = !current;
    setTools((prev) =>
      prev.map((t) => t.name === toolName ? { ...t, requiresConfirmation: updated } : t),
    );
    try {
      await apiClient.patch(`/api/tools/${toolName}`, { requiresConfirmation: updated });
    } catch {
      // Revert on failure
      setTools((prev) =>
        prev.map((t) => t.name === toolName ? { ...t, requiresConfirmation: current } : t),
      );
    }
  }, []);

  const normalizedQuery = query.trim().toLowerCase();
  const filteredTools = normalizedQuery
    ? tools.filter((tool) => (
      `${tool.name} ${tool.description} ${tool.serverKey ?? ''}`.toLowerCase().includes(normalizedQuery)
    ))
    : tools;
  const grouped = groupToolsByPrefix(filteredTools);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="shrink-0 space-y-2 border-b border-base-300 px-3 py-2.5">
        <div className="flex items-center justify-between">
          <span className="text-xs text-base-content/60">{tools.length} tool{tools.length !== 1 ? 's' : ''}</span>
          <button
            className="btn btn-ghost btn-xs"
            onClick={() => void load()}
            disabled={loading}
            title="Refresh tools"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
        <label className="input input-bordered input-sm flex h-9 min-h-9 items-center gap-2 bg-base-200/45">
          <Search size={14} className="text-base-content/45" />
          <input
            type="search"
            aria-label="Search tools"
            className="grow text-sm"
            placeholder="Search tools"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {query && (
            <button type="button" className="grid h-6 w-6 place-items-center rounded hover:bg-base-300" onClick={() => setQuery('')} aria-label="Clear tool search">
              <X size={13} />
            </button>
          )}
        </label>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading && tools.length === 0 && (
          <div className="flex items-center justify-center h-24 text-base-content/40 text-xs">Loading…</div>
        )}
        {error && (
          <div className="p-3 text-xs text-error/80">{error}</div>
        )}
        {!loading && tools.length === 0 && !error && (
          <div className="flex flex-col items-center justify-center h-32 gap-2 text-base-content/30">
            <Wrench size={24} />
            <span className="text-xs">No tools registered</span>
          </div>
        )}
        {!loading && tools.length > 0 && filteredTools.length === 0 && (
          <div className="flex h-28 flex-col items-center justify-center gap-2 text-sm text-base-content/45">
            <Search size={22} />
            <span>No tools match “{query}”</span>
          </div>
        )}
        {grouped.map(({ label, tools: groupTools }) => (
          <div key={label}>
            <div className="flex items-center justify-between border-b border-base-300/40 bg-base-200/45 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-base-content/55">
              <span>{label}</span>
              <span className="font-mono text-[10px] text-base-content/40">{groupTools.length}</span>
            </div>
            {groupTools.map((tool) => (
              <ToolRow key={tool.name} tool={tool} onToggleConfirmation={handleToggleConfirmation} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function ToolRow({ tool, onToggleConfirmation }: { tool: ToolMeta; onToggleConfirmation: (name: string, current: boolean) => void }) {
  const [expanded, setExpanded] = useState(false);
  const required: string[] = (() => {
    try {
      const schema = tool.parameters as { required?: string[] };
      return Array.isArray(schema.required) ? schema.required : [];
    } catch {
      return [];
    }
  })();

  return (
    <div className="border-b border-base-300/50">
      <div className="flex items-start gap-1">
        <button
          className="flex-1 text-left px-3 py-2 hover:bg-base-200/50 transition-colors"
          onClick={() => setExpanded((v) => !v)}
        >
          <div className="flex items-start gap-2">
            <Wrench size={12} className="mt-1 shrink-0 text-base-content/40" />
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-1">
                <span className="font-mono text-xs text-primary">{tool.name}</span>
                {tool.serverKey && (
                  <span className="badge badge-xs badge-ghost font-mono text-base-content/50" title={`MCP serverKey: ${tool.serverKey}`}>
                    {tool.serverKey}
                  </span>
                )}
              </div>
              {expanded && (
                <>
                  <p className="text-xs text-base-content/60 mt-0.5 whitespace-normal">{tool.description}</p>
                  {required.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {required.map((p) => (
                        <span key={p} className="badge badge-xs badge-ghost font-mono">{p}</span>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </button>
        {/* requiresConfirmation toggle */}
        <button
          className={`mr-2 mt-2 inline-flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-[11px] font-medium transition-colors ${
            tool.requiresConfirmation
              ? 'bg-warning/10 text-warning hover:bg-warning/15'
              : 'bg-base-200/65 text-base-content/55 hover:bg-base-300 hover:text-base-content/75'
          }`}
          title={tool.requiresConfirmation ? 'Requires confirmation (click to disable)' : 'Auto-execute (click to require confirmation)'}
          onClick={(e) => { e.stopPropagation(); void onToggleConfirmation(tool.name, tool.requiresConfirmation); }}
        >
          {tool.requiresConfirmation ? <Shield size={12} /> : <ShieldOff size={12} />}
          <span>{tool.requiresConfirmation ? 'Confirmation' : 'Auto'}</span>
        </button>
      </div>
    </div>
  );
}
