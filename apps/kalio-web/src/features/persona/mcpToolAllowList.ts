import type { ToolMeta } from '@kalio/types';

// TODO: legacy fallback - accept persisted mcp_<serverId>_<tool> entries for one release.
export function toLegacyMcpToolName(toolName: string): string | null {
  if (!toolName.startsWith('mcp_')) {
    return null;
  }

  const body = toolName.slice(4);
  const serverKeySeparator = body.indexOf('::');
  if (serverKeySeparator < 0) {
    return null;
  }

  const toolSeparator = body.lastIndexOf('_');
  if (toolSeparator <= serverKeySeparator + 2 || toolSeparator === body.length - 1) {
    return null;
  }

  const legacyServerId = body.slice(serverKeySeparator + 2, toolSeparator);
  const toolId = body.slice(toolSeparator + 1);
  if (!legacyServerId || !toolId) {
    return null;
  }

  return `mcp_${legacyServerId}_${toolId}`;
}

export function normalizeMcpAllowList(selected: string[], mcpTools: Pick<ToolMeta, 'name'>[]): string[] {
  const canonicalByLegacy = new Map<string, string>();
  const ambiguousLegacies = new Set<string>();

  for (const tool of mcpTools) {
    const legacyName = toLegacyMcpToolName(tool.name);
    if (!legacyName) {
      continue;
    }

    const existing = canonicalByLegacy.get(legacyName);
    if (existing && existing !== tool.name) {
      ambiguousLegacies.add(legacyName);
      continue;
    }

    if (!existing) {
      canonicalByLegacy.set(legacyName, tool.name);
    }
  }

  for (const legacyName of ambiguousLegacies) {
    canonicalByLegacy.delete(legacyName);
  }

  const next: string[] = [];
  const seen = new Set<string>();
  for (const toolName of selected) {
    const canonical = canonicalByLegacy.get(toolName) ?? toolName;
    if (seen.has(canonical)) {
      continue;
    }
    seen.add(canonical);
    next.push(canonical);
  }
  return next;
}

export function isMcpToolSelected(selectedSet: Set<string>, toolName: string): boolean {
  const legacy = toLegacyMcpToolName(toolName);
  return selectedSet.has(toolName) || (legacy !== null && selectedSet.has(legacy));
}
