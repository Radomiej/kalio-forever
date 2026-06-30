import type { ToolMeta } from '@kalio/types';

type ToolNameRef = Pick<ToolMeta, 'name'> | string;
type McpToolRef = Pick<ToolMeta, 'name' | 'aliases'>;

export function normalizeMcpAllowList(
  selected: string[],
  mcpTools: McpToolRef[],
  nativeTools: ToolNameRef[] = [],
): string[] {
  const available = new Set(mcpTools.map((tool) => tool.name));
  const aliases = buildMcpAliasMap(mcpTools);
  const nativeNames = new Set(nativeTools.map((tool) => typeof tool === 'string' ? tool : tool.name));
  const next: string[] = [];
  const seen = new Set<string>();
  for (const toolName of selected) {
    const normalized = normalizeToolName(toolName, available, aliases, nativeNames);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    next.push(normalized);
  }
  return next;
}

export function isMcpToolSelected(selectedSet: Set<string>, toolName: string): boolean {
  return selectedSet.has(toolName);
}

function normalizeToolName(
  toolName: string,
  availableMcpTools: Set<string>,
  aliasTargets: Map<string, string | null>,
  nativeToolNames: Set<string>,
): string | null {
  if (nativeToolNames.has(toolName)) {
    return toolName;
  }
  if (availableMcpTools.has(toolName)) {
    return toolName;
  }
  if (aliasTargets.has(toolName)) {
    return aliasTargets.get(toolName) ?? null;
  }
  return toolName;
}

function buildMcpAliasMap(mcpTools: McpToolRef[]): Map<string, string | null> {
  const aliases = new Map<string, string | null>();
  for (const tool of mcpTools) {
    for (const alias of tool.aliases ?? []) {
      const existing = aliases.get(alias);
      if (existing && existing !== tool.name) {
        aliases.set(alias, null);
        continue;
      }
      if (!aliases.has(alias)) {
        aliases.set(alias, tool.name);
      }
    }
  }
  return aliases;
}
