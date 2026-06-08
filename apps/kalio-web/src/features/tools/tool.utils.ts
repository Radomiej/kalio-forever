import type { ToolMeta } from '@kalio/types';

const SUBAGENT_TOOLS = new Set([
  'run_subagent',
  'spawn_subagent',
  'message_subagent',
]);

const CLI_AGENT_TOOLS = new Set([
  'run_cli_agent',
  'spawn_cli_agent',
  'message_cli_agent',
  'get_cli_agent_status',
  'stop_cli_agent',
]);

const AGENT_WORKFLOW_TOOLS = new Set([
  'run_sub_agentflow',
  'wait_for',
]);

const SECURITY_AUDIT_TOOLS = new Set([
  'escalate',
]);

interface ToolGroupDefinition {
  key: string;
  label: string;
  match: (name: string) => boolean;
}

export const NATIVE_TOOL_GROUPS: ToolGroupDefinition[] = [
  { key: 'subagents', label: 'Subagents', match: (name) => SUBAGENT_TOOLS.has(name) },
  { key: 'cli-agents', label: 'CLI Agents', match: (name) => CLI_AGENT_TOOLS.has(name) },
  { key: 'agent-workflows', label: 'Agent Workflows', match: (name) => AGENT_WORKFLOW_TOOLS.has(name) },
  { key: 'security-audit', label: 'Security & Audit', match: (name) => SECURITY_AUDIT_TOOLS.has(name) },
  { key: 'vfs', label: 'Virtual Filesystem', match: (name) => name.startsWith('vfs_') },
  { key: 'fs', label: 'Filesystem', match: (name) => name.startsWith('fs_') },
  { key: 'kv', label: 'Key-Value Store', match: (name) => name.startsWith('kv_') },
  { key: 'terminal', label: 'Terminal', match: (name) => name.startsWith('terminal_') },
  { key: 'raapp', label: 'RAApp', match: (name) => name.startsWith('raapp_') || name === 'run_raapp' || name === 'list_raapps' },
  { key: 'preview', label: 'Preview', match: (name) => name === 'design_preview' },
  { key: 'memory', label: 'Memory', match: (name) => name.startsWith('memory_') },
  { key: 'search', label: 'Search', match: (name) => name === 'grep_search' || name === 'file_search' },
  { key: 'web', label: 'Web', match: (name) => name === 'web_search' },
  { key: 'tools', label: 'Tools', match: (name) => name === 'list_tools' || name === 'get_tool_details' },
  { key: 'images', label: 'Images', match: (name) => name.startsWith('image_') },
  { key: 'skills', label: 'Skills', match: (name) => name.startsWith('skill_') },
  { key: 'persona', label: 'Persona', match: (name) => name.startsWith('persona_') },
];

export function getNativeToolGroupKey(name: string): string {
  return NATIVE_TOOL_GROUPS.find((group) => group.match(name))?.key ?? 'other';
}

export function getNativeToolGroupLabel(key: string): string {
  return NATIVE_TOOL_GROUPS.find((group) => group.key === key)?.label ?? 'Other';
}

export function groupToolsByPrefix(tools: ToolMeta[]): Array<{ label: string; tools: ToolMeta[] }> {
  const groups: Array<{ label: string; tools: ToolMeta[] }> = [];
  const assigned = new Set<string>();

  for (const group of NATIVE_TOOL_GROUPS) {
    const matched = tools.filter((tool) => !assigned.has(tool.name) && group.match(tool.name));
    if (matched.length > 0) {
      matched.forEach((tool) => assigned.add(tool.name));
      groups.push({ label: group.label, tools: matched });
    }
  }

  const rest = tools.filter((tool) => !assigned.has(tool.name));
  if (rest.length > 0) {
    groups.push({ label: 'Other', tools: rest });
  }

  return groups;
}
