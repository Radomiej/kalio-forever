import type { ToolDomain, ToolMeta } from '@kalio/types';

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

const VFS_TOOLS = new Set([
  'vfs_delete',
  'vfs_file_search',
  'vfs_grep_search',
  'vfs_list',
  'vfs_read',
  'vfs_read_file',
  'vfs_search',
  'vfs_write',
  'vfs_write_file',
]);

const FILE_SYSTEM_TOOLS = new Set([
  'fs_list',
  'fs_read',
  'fs_search',
  'fs_write',
]);

const KEY_VALUE_TOOLS = new Set([
  'kv_delete',
  'kv_get',
  'kv_list',
  'kv_read',
  'kv_write',
]);

const TERMINAL_TOOLS = new Set([
  'terminal_exec',
  'terminal_kill',
  'terminal_list',
  'terminal_output',
  'terminal_spawn',
]);

const RAAPP_TOOLS = new Set([
  'list_raapps',
  'raapp_compile',
  'raapp_create',
  'raapp_create_draft',
  'raapp_delete',
  'raapp_edit',
  'raapp_execute_dsl',
  'raapp_get',
  'raapp_publish_draft',
  'raapp_test',
  'run_raapp',
]);

const PREVIEW_TOOLS = new Set([
  'design_preview',
]);

const MEMORY_TOOLS = new Set([
  'memory_ingest',
  'memory_ingest_conversation',
  'memory_search',
]);

const SEARCH_TOOLS = new Set([
  'file_search',
  'grep_search',
]);

const WEB_TOOLS = new Set([
  'web_search',
]);

const TOOL_REGISTRY_TOOLS = new Set([
  'get_tool_details',
  'list_tools',
]);

const IMAGE_TOOLS = new Set([
  'image_edit',
  'image_generate',
  'image_view',
]);

const SKILL_TOOLS = new Set([
  'skill_create',
  'skill_delete',
  'skill_list',
  'skill_read',
  'skill_run',
  'skill_update',
]);

const PERSONA_TOOLS = new Set([
  'persona_create',
  'persona_delete',
  'persona_list',
  'persona_update',
]);

interface ToolGroupDefinition {
  key: string;
  label: string;
  domains: ToolDomain[];
  legacyNames?: Set<string>;
}

export const NATIVE_TOOL_GROUPS: ToolGroupDefinition[] = [
  { key: 'subagents', label: 'Subagents', domains: ['subagent'], legacyNames: SUBAGENT_TOOLS },
  { key: 'cli-agents', label: 'CLI Agents', domains: ['cli_agent'], legacyNames: CLI_AGENT_TOOLS },
  { key: 'agent-workflows', label: 'Agent Workflows', domains: ['agent_workflow'], legacyNames: AGENT_WORKFLOW_TOOLS },
  { key: 'security-audit', label: 'Security & Audit', domains: ['security_audit'], legacyNames: SECURITY_AUDIT_TOOLS },
  { key: 'vfs', label: 'Virtual Filesystem', domains: ['vfs'], legacyNames: VFS_TOOLS },
  { key: 'fs', label: 'Filesystem', domains: ['file_system'], legacyNames: FILE_SYSTEM_TOOLS },
  { key: 'kv', label: 'Key-Value Store', domains: ['key_value'], legacyNames: KEY_VALUE_TOOLS },
  { key: 'terminal', label: 'Terminal', domains: ['terminal'], legacyNames: TERMINAL_TOOLS },
  { key: 'raapp', label: 'RAApp', domains: ['raapp'], legacyNames: RAAPP_TOOLS },
  { key: 'preview', label: 'Preview', domains: ['preview'], legacyNames: PREVIEW_TOOLS },
  { key: 'memory', label: 'Memory', domains: ['memory'], legacyNames: MEMORY_TOOLS },
  { key: 'search', label: 'Search', domains: ['file_search', 'search'], legacyNames: SEARCH_TOOLS },
  { key: 'web', label: 'Web', domains: ['web'], legacyNames: WEB_TOOLS },
  { key: 'tools', label: 'Tools', domains: ['tool_registry'], legacyNames: TOOL_REGISTRY_TOOLS },
  { key: 'images', label: 'Images', domains: ['image'], legacyNames: IMAGE_TOOLS },
  { key: 'skills', label: 'Skills', domains: ['skill'], legacyNames: SKILL_TOOLS },
  { key: 'persona', label: 'Persona', domains: ['persona'], legacyNames: PERSONA_TOOLS },
];

const MCP_TOOL_GROUP: ToolGroupDefinition = {
  key: 'mcp',
  label: 'MCP',
  domains: ['mcp'],
};

const TOOL_GROUPS = [...NATIVE_TOOL_GROUPS, MCP_TOOL_GROUP];

export function getNativeToolGroupKey(name: string): string {
  // TODO: legacy fallback for persisted tool names that predate ToolMeta.domain.
  return NATIVE_TOOL_GROUPS.find((group) => group.legacyNames?.has(name))?.key ?? 'other';
}

export function getNativeToolGroupLabel(key: string): string {
  return TOOL_GROUPS.find((group) => group.key === key)?.label ?? 'Other';
}

export function groupToolsByPrefix(tools: ToolMeta[]): Array<{ label: string; tools: ToolMeta[] }> {
  const groups: Array<{ label: string; tools: ToolMeta[] }> = [];
  const assigned = new Set<string>();

  for (const group of TOOL_GROUPS) {
    const matched = tools.filter((tool) => !assigned.has(tool.name) && getToolGroupKey(tool) === group.key);
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

export function getToolGroupKey(tool: ToolMeta): string {
  const domainGroup = TOOL_GROUPS.find((group) => tool.domain && group.domains.includes(tool.domain))?.key;
  if (domainGroup) return domainGroup;
  if (typeof tool.serverKey === 'string' && tool.serverKey.trim().length > 0) return MCP_TOOL_GROUP.key;
  return getNativeToolGroupKey(tool.name);
}
