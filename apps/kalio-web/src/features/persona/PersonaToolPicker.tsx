import { useEffect, useState, useCallback } from 'react';
import { ChevronDown } from 'lucide-react';
import type { MCPPolicy, ToolMeta } from '@kalio/types';
import { getNativeToolGroupKey, getToolGroupKey } from '../tools/tool.utils';
import { isMcpToolSelected, normalizeMcpAllowList } from './mcpToolAllowList';

const GROUP_LABELS: Record<string, string> = {
  vfs: 'VFS',
  fs: 'Filesystem',
  memory: 'Memory',
  terminal: 'Terminal',
  kv: 'KV Store',
  raapp: 'RAApp',
  subagents: 'Subagents',
  'cli-agents': 'CLI Agents',
  'agent-workflows': 'Agent Workflows',
  'security-audit': 'Security & Audit',
  preview: 'Preview',
  websearch: 'Web Search',
  tools: 'Tools',
  images: 'Images',
  skills: 'Skills',
  persona: 'Persona',
  other: 'Other',
};

function displayGroupFromKey(key: string): string {
  if (key === 'search') return 'fs';
  if (key === 'web') return 'websearch';

  return key;
}

function deriveGroup(name: string): string {
  return displayGroupFromKey(getNativeToolGroupKey(name));
}

function deriveToolGroup(tool: ToolMeta): string {
  return displayGroupFromKey(getToolGroupKey(tool));
}

interface Props {
  selected: string[];
  mcpPolicy: MCPPolicy;
  onChange: (tools: string[], mcpPolicy: MCPPolicy) => void;
}

interface ToolGroup {
  key: string;
  label: string;
  tools: ToolMeta[];
}

const MCP_POLICY_LABELS: Record<MCPPolicy, string> = {
  allow_all:  'Allow all',
  deny_all:   'Deny all',
  allow_list: 'Allow list',
};

export function PersonaToolPicker({ selected, mcpPolicy, onChange }: Props) {
  const [groups, setGroups] = useState<ToolGroup[]>([]);
  const [mcpTools, setMcpTools] = useState<ToolMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const allNativeNames = groups.flatMap((g) => g.tools.map((t) => t.name));
  const mcpToolNames = new Set(mcpTools.map((tool) => tool.name));
  const normalizedSelected = normalizeMcpAllowList(selected, mcpTools, allNativeNames);

  useEffect(() => {
    if (mcpPolicy !== 'allow_list' || mcpTools.length === 0) {
      return;
    }

    if (normalizedSelected.length === selected.length && normalizedSelected.every((name, index) => name === selected[index])) {
      return;
    }

    onChange(normalizedSelected, mcpPolicy);
  }, [mcpPolicy, mcpTools, normalizedSelected, onChange, selected]);

  const load = useCallback(async () => {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 6000);

    try {
      setLoading(true);
      setLoadError(null);
      const res = await fetch('/api/tools', { signal: controller.signal });
      if (!res.ok) throw new Error(`Tools request failed: ${res.status}`);
      const data: ToolMeta[] = await res.json() as ToolMeta[];
      const nativeTools = data.filter(t => !isMcpToolMeta(t));
      const mcp = data.filter(t => isMcpToolMeta(t));
      setMcpTools(mcp);
      const map = new Map<string, ToolMeta[]>();
      for (const tool of nativeTools) {
        const g = deriveToolGroup(tool);
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
      setLoadError('Unable to load tools.');
    } finally {
      window.clearTimeout(timeoutId);
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const selectedSet = new Set(normalizedSelected);
  const mcpAllowListNames = normalizedSelected.filter((n) => mcpToolNames.has(n));

  const toggleTool = (name: string) => {
    const next = new Set(selectedSet);
    if (next.has(name)) {
      next.delete(name);
    } else {
      next.add(name);
    }
    onChange([...next], mcpPolicy);
  };

  const toggleGroup = (group: ToolGroup) => {
    const names = group.tools.map((t) => t.name);
    const allOn = names.every((n) => selectedSet.has(n));
    const next = new Set(selectedSet);
    names.forEach((name) => {
      if (allOn) {
        next.delete(name);
      } else {
        next.add(name);
      }
    });
    onChange([...next], mcpPolicy);
  };

  const toggleMcpTool = (name: string) => {
    const next = new Set(selectedSet);
    if (next.has(name)) {
      next.delete(name);
    } else {
      next.add(name);
    }
    onChange([...next], 'allow_list');
  };

  const preservedMcpAllowListNames = mcpPolicy === 'allow_list' ? mcpAllowListNames : [];
  const enableAll = () => onChange([...allNativeNames, ...preservedMcpAllowListNames], mcpPolicy);
  const disableAll = () => onChange(preservedMcpAllowListNames, mcpPolicy);

  const setPolicy = (policy: MCPPolicy) => {
    if (policy !== 'allow_list') {
      const withoutMcp = normalizedSelected.filter((n) => !mcpToolNames.has(n));
      onChange(withoutMcp, policy);
    } else {
      onChange(normalizedSelected, policy);
    }
  };

  if (loading) {
    return (
      <div data-testid="persona-tool-picker" className="text-xs text-base-content/40 py-1">
        Loading tools…
      </div>
    );
  }
  if (loadError) {
    return (
      <div data-testid="persona-tool-picker" className="flex items-center justify-between gap-2 rounded border border-error/30 bg-error/10 px-3 py-2">
        <span className="text-xs text-error">{loadError}</span>
        <button type="button" className="btn btn-xs btn-ghost text-error" onClick={() => void load()}>
          Retry
        </button>
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
            ({allNativeNames.filter((name) => selectedSet.has(name)).length}/{allNativeNames.length})
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

      {/* MCP section */}
      <div className="rounded border border-base-300 overflow-hidden mt-1">
        <div className="flex items-center gap-2 px-2 py-1.5 bg-base-200/60">
          <span className="text-xs font-medium text-base-content/80 flex-1">MCP Tools</span>
          {mcpTools.length > 0 && (
            <span className="text-[10px] text-base-content/40">
              {mcpPolicy === 'allow_list' ? `${mcpAllowListNames.length}/${mcpTools.length}` : `${mcpTools.length} available`}
            </span>
          )}
        </div>
        <div className="px-2 py-2 bg-base-100/30 flex flex-col gap-2">
          {/* Policy radio group */}
          <div className="flex gap-3">
            {(['allow_all', 'deny_all', 'allow_list'] as MCPPolicy[]).map((p) => (
              <label
                key={p}
                className="flex items-center gap-1 cursor-pointer"
                data-testid={`mcp-policy-${p}`}
              >
                <input
                  type="radio"
                  className="radio radio-xs"
                  name="mcp-policy"
                  checked={mcpPolicy === p}
                  onChange={() => setPolicy(p)}
                />
                <span className="text-[11px] text-base-content/70">{MCP_POLICY_LABELS[p]}</span>
              </label>
            ))}
          </div>

          {/* Allow-list checkboxes */}
          {mcpPolicy === 'allow_list' && (
            mcpTools.length === 0 ? (
              <span className="text-[10px] text-base-content/30">No MCP servers connected</span>
            ) : (
              <div className="space-y-0.5 border-t border-base-300 pt-1.5">
                {mcpTools.map((tool) => (
                  <label
                    key={tool.name}
                    className="flex items-center gap-2 py-0.5 cursor-pointer hover:bg-base-200/40 rounded px-1"
                    data-testid={`tool-toggle-${tool.name}`}
                  >
                    <input
                      type="checkbox"
                      className="checkbox checkbox-xs"
                      checked={isMcpToolSelected(selectedSet, tool.name)}
                      onChange={() => toggleMcpTool(tool.name)}
                    />
                    <span className="font-mono text-[11px] text-secondary/80 truncate">{tool.name}</span>
                    {tool.requiresConfirmation && (
                      <span className="badge badge-xs badge-warning shrink-0">confirm</span>
                    )}
                  </label>
                ))}
              </div>
            )
          )}
          {mcpPolicy === 'allow_all' && (
            <span className="text-[10px] text-base-content/40">All connected MCP tools are accessible</span>
          )}
          {mcpPolicy === 'deny_all' && (
            <span className="text-[10px] text-base-content/40">MCP tools are blocked for this persona</span>
          )}
        </div>
      </div>
    </div>
  );
}

function isMcpToolMeta(tool: ToolMeta): boolean {
  return typeof tool.serverKey === 'string' && tool.serverKey.trim().length > 0;
}

/** Compact read-only summary shown in the expanded persona view */
export function PersonaToolBadges({ tools, mcpPolicy }: { tools: string[]; mcpPolicy?: MCPPolicy }) {
  const mcpSelected: string[] = [];
  const knownNativeTools: string[] = [];
  for (const name of tools) {
    const group = deriveGroup(name);
    if (group === 'other' && mcpPolicy && mcpPolicy !== 'deny_all') {
      mcpSelected.push(name);
    } else {
      knownNativeTools.push(name);
    }
  }
  if (knownNativeTools.length === 0 && (!mcpPolicy || mcpPolicy === 'deny_all')) {
    return <span className="text-[10px] text-base-content/30">No tools enabled</span>;
  }
  const byGroup = new Map<string, string[]>();
  for (const name of knownNativeTools) {
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
      {mcpPolicy && mcpPolicy !== 'deny_all' && (
        <span
          className="badge badge-xs badge-secondary font-mono"
          title={mcpPolicy === 'allow_list' ? mcpSelected.join(', ') : 'All MCP tools allowed'}
        >
          MCP:{mcpPolicy === 'allow_all' ? 'all' : mcpSelected.length}
        </span>
      )}
    </div>
  );
}
