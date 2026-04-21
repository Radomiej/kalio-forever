import { useEffect, useState, useCallback } from 'react';
import { RefreshCw, Wrench, ShieldAlert } from 'lucide-react';
import { apiClient } from '../../services/apiClient';
import type { ToolMeta } from '@kalio/types';

export function ToolPanel() {
  const [tools, setTools] = useState<ToolMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [nativeRes, mcpRes] = await Promise.allSettled([
        apiClient.get<ToolMeta[]>('/api/tools'),
        apiClient.get<ToolMeta[]>('/api/mcp/tools'),
      ]);
      const native = nativeRes.status === 'fulfilled' ? nativeRes.value.data : [];
      const mcp = mcpRes.status === 'fulfilled' ? mcpRes.value.data : [];
      setTools([...native, ...mcp]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load tools');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-base-300 shrink-0">
        <span className="text-xs text-base-content/50">{tools.length} tool{tools.length !== 1 ? 's' : ''}</span>
        <button
          className="btn btn-ghost btn-xs"
          onClick={() => void load()}
          disabled={loading}
          title="Refresh tools"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
        </button>
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
        {tools.map((tool) => (
          <ToolRow key={tool.name} tool={tool} />
        ))}
      </div>
    </div>
  );
}

function ToolRow({ tool }: { tool: ToolMeta }) {
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
    <button
      className="w-full text-left px-3 py-2 border-b border-base-300/50 hover:bg-base-200/50 transition-colors"
      onClick={() => setExpanded((v) => !v)}
    >
      <div className="flex items-start gap-2">
        <Wrench size={12} className="mt-1 shrink-0 text-base-content/40" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1 flex-wrap">
            <span className="font-mono text-xs text-primary truncate">{tool.name}</span>
            {tool.requiresConfirmation && (
              <span title="Requires confirmation" className="text-warning">
                <ShieldAlert size={10} />
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
  );
}
