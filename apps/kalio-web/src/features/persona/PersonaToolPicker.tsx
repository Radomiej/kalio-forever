import { useEffect, useState, useCallback } from 'react';
import { ChevronDown } from 'lucide-react';
import type { ToolMeta } from '@kalio/types';

const GROUP_LABELS: Record<string, string> = {
  vfs: 'VFS',
  fs: 'Filesystem',
  memory: 'Memory',
  terminal: 'Terminal',
  kv: 'KV Store',
  raapp: 'RA-Apps',
  search: 'Search',
  agent: 'Agent',
  other: 'Other',
};

function deriveGroup(name: string): string {
  if (name.startsWith('vfs_')) return 'vfs';
  if (name.startsWith('fs_')) return 'fs';
  if (name.startsWith('memory_')) return 'memory';
  if (name.startsWith('terminal_')) return 'terminal';
  if (name.startsWith('kv_')) return 'kv';
  if (name.startsWith('raapp_') || name === 'run_raapp' || name === 'list_raapps') return 'raapp';
  if (name.startsWith('grep_') || name === 'file_search') return 'search';
  if (name === 'run_subagent') return 'agent';
  return 'other';
}

interface Props {
  selected: string[];
  onChange: (tools: string[]) => void;
}

interface ToolGroup {
  key: string;
  label: string;
  tools: ToolMeta[];
}

export function PersonaToolPicker({ selected, onChange }: Props) {
  const [groups, setGroups] = useState<ToolGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/tools');
      const data: ToolMeta[] = await res.json() as ToolMeta[];
      const map = new Map<string, ToolMeta[]>();
      for (const tool of data) {
        const g = deriveGroup(tool.name);
        const arr = map.get(g) ?? [];
        arr.push(tool);
        map.set(g, arr);
      }
      // Preserve order: known groups first, then 'other'
      const orderedKeys = Object.keys(GROUP_LABELS);
      const result: ToolGroup[] = [];
      for (const key of orderedKeys) {
        const tools = map.get(key);
        if (tools && tools.length > 0) {
          result.push({ key, label: GROUP_LABELS[key] ?? key, tools });
        }
      }
      setGroups(result);
    } catch (err) {
      console.error('[PersonaToolPicker] load failed', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const selectedSet = new Set(selected);
  const allNames = groups.flatMap((g) => g.tools.map((t) => t.name));

  const toggleTool = (name: string) => {
    const next = new Set(selectedSet);
    next.has(name) ? next.delete(name) : next.add(name);
    onChange([...next]);
  };

  const toggleGroup = (group: ToolGroup) => {
    const names = group.tools.map((t) => t.name);
    const allOn = names.every((n) => selectedSet.has(n));
    const next = new Set(selectedSet);
    names.forEach((n) => (allOn ? next.delete(n) : next.add(n)));
    onChange([...next]);
  };

  const enableAll = () => onChange([...allNames]);
  const disableAll = () => onChange([]);

  if (loading) {
    return (
      <div data-testid="persona-tool-picker" className="text-xs text-base-content/40 py-1">
        Loading tools…
      </div>
    );
  }
  if (groups.length === 0) {
    return (
      <div data-testid="persona-tool-picker" className="text-xs text-base-content/40 py-1">
        No tools available
      </div>
    );
  }

  return (
    <div data-testid="persona-tool-picker" className="flex flex-col gap-0.5">
      {/* Global controls */}
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-medium text-base-content/70">
          Tools
          <span className="ml-1 text-base-content/40">
            ({selected.length}/{allNames.length})
          </span>
        </span>
        <div className="flex gap-1">
          <button
            type="button"
            className="btn btn-xs btn-ghost py-0 h-5 min-h-0 text-[10px]"
            onClick={enableAll}
            data-testid="tools-enable-all"
          >
            All
          </button>
          <button
            type="button"
            className="btn btn-xs btn-ghost py-0 h-5 min-h-0 text-[10px] text-base-content/50"
            onClick={disableAll}
            data-testid="tools-disable-all"
          >
            None
          </button>
        </div>
      </div>

      {/* Groups */}
      {groups.map((group) => {
        const names = group.tools.map((t) => t.name);
        const enabledCount = names.filter((n) => selectedSet.has(n)).length;
        const allOn = enabledCount === names.length;
        const partial = enabledCount > 0 && !allOn;
        const open = !collapsed[group.key];

        return (
          <div key={group.key} className="rounded border border-base-300 overflow-hidden">
            {/* Group header */}
            <div className="flex items-center gap-2 px-2 py-1.5 bg-base-200/60">
              <input
                type="checkbox"
                className="checkbox checkbox-xs"
                checked={allOn}
                ref={(el) => { if (el) el.indeterminate = partial; }}
                onChange={() => toggleGroup(group)}
                data-testid={`group-toggle-${group.key}`}
              />
              <button
                type="button"
                className="flex items-center gap-1 flex-1 min-w-0 text-left"
                onClick={() => setCollapsed((c) => ({ ...c, [group.key]: !c[group.key] }))}
              >
                <span className="text-xs font-medium text-base-content/80">{group.label}</span>
                <span className="text-[10px] text-base-content/40 ml-auto">
                  {enabledCount}/{names.length}
                </span>
                <ChevronDown
                  size={10}
                  className={`shrink-0 text-base-content/30 transition-transform ${open ? 'rotate-180' : ''}`}
                />
              </button>
            </div>

            {/* Tool list */}
            {open && (
              <div className="px-2 py-1 space-y-0.5 bg-base-100/30">
                {group.tools.map((tool) => (
                  <label
                    key={tool.name}
                    className="flex items-center gap-2 py-0.5 cursor-pointer hover:bg-base-200/40 rounded px-1"
                    data-testid={`tool-toggle-${tool.name}`}
                  >
                    <input
                      type="checkbox"
                      className="checkbox checkbox-xs"
                      checked={selectedSet.has(tool.name)}
                      onChange={() => toggleTool(tool.name)}
                    />
                    <span className="font-mono text-[11px] text-primary/80 truncate">{tool.name}</span>
                    {tool.requiresConfirmation && (
                      <span className="badge badge-xs badge-warning shrink-0">confirm</span>
                    )}
                  </label>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Compact read-only summary shown in the expanded persona view */
export function PersonaToolBadges({ tools }: { tools: string[] }) {
  if (tools.length === 0) {
    return <span className="text-[10px] text-base-content/30">No tools enabled</span>;
  }
  // Group them
  const byGroup = new Map<string, string[]>();
  for (const name of tools) {
    const g = deriveGroup(name);
    const arr = byGroup.get(g) ?? [];
    arr.push(name);
    byGroup.set(g, arr);
  }
  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {[...byGroup.entries()].map(([g, names]) => (
        <span key={g} className="badge badge-xs badge-ghost font-mono" title={names.join(', ')}>
          {GROUP_LABELS[g] ?? g} ×{names.length}
        </span>
      ))}
    </div>
  );
}
