import type { ToolMeta } from '@kalio/types';

export function normalizeMcpAllowList(selected: string[], mcpTools: Pick<ToolMeta, 'name'>[]): string[] {
  const available = new Set(mcpTools.map((tool) => tool.name));
  const next: string[] = [];
  const seen = new Set<string>();
  for (const toolName of selected) {
    if (!available.has(toolName) || seen.has(toolName)) {
      continue;
    }
    seen.add(toolName);
    next.push(toolName);
  }
  return next;
}

export function isMcpToolSelected(selectedSet: Set<string>, toolName: string): boolean {
  return selectedSet.has(toolName);
}
