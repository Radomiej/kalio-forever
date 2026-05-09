import type { ToolMeta } from '@kalio/types';

// ─── tool group definitions ───────────────────────────────────────────────────

interface ToolGroup {
  label: string;
  match: (name: string) => boolean;
}

const TOOL_GROUPS: ToolGroup[] = [
  { label: 'Agent',              match: (n) => n === 'run_subagent' || n === 'run_cli_agent' },
  { label: 'Virtual Filesystem', match: (n) => n.startsWith('vfs_') },
  { label: 'Filesystem',         match: (n) => n.startsWith('fs_') },
  { label: 'Key-Value Store',    match: (n) => n.startsWith('kv_') },
  { label: 'Terminal',           match: (n) => n.startsWith('terminal_') },
  { label: 'RaConsierge',        match: (n) => n.startsWith('raapp_') || n === 'run_raapp' || n === 'list_raapps' },
  { label: 'Memory',             match: (n) => n.startsWith('memory_') },
  { label: 'Search',             match: (n) => n === 'grep_search' || n === 'file_search' },
  { label: 'Web',                match: (n) => n === 'web_search' },
  { label: 'Tools',              match: (n) => n === 'list_tools' || n === 'get_tool_details' },
  { label: 'Images',             match: (n) => n.startsWith('image_') },
  { label: 'Skills',             match: (n) => n.startsWith('skill_') },
  { label: 'Persona',            match: (n) => n.startsWith('persona_') },
];

export function groupToolsByPrefix(tools: ToolMeta[]): Array<{ label: string; tools: ToolMeta[] }> {
  const groups: Array<{ label: string; tools: ToolMeta[] }> = [];
  const assigned = new Set<string>();

  for (const group of TOOL_GROUPS) {
    const matched = tools.filter((t) => !assigned.has(t.name) && group.match(t.name));
    if (matched.length > 0) {
      matched.forEach((t) => assigned.add(t.name));
      groups.push({ label: group.label, tools: matched });
    }
  }

  const rest = tools.filter((t) => !assigned.has(t.name));
  if (rest.length > 0) groups.push({ label: 'Other', tools: rest });

  return groups;
}
