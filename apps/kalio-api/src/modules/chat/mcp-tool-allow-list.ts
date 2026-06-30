import type { ToolMeta } from '@kalio/types';

type ToolAliasMeta = Pick<ToolMeta, 'name' | 'aliases'>;

export function resolveToolAlias(toolName: string, availableTools: Iterable<ToolAliasMeta>): string | null {
  let aliasMatch: string | null = null;

  for (const tool of availableTools) {
    if (tool.name === toolName) {
      return tool.name;
    }
    if (!tool.aliases?.includes(toolName)) {
      continue;
    }
    if (aliasMatch) {
      return null;
    }
    aliasMatch = tool.name;
  }

  return aliasMatch;
}
