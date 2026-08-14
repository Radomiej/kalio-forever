import type { MCPTool } from '@kalio/types';
import type { ServerHandle } from './mcp-runtime.utils';

export interface McpToolNameRef {
  serverKey: string;
  originalName: string;
}

export function rebuildMcpToolNameMap(
  handles: Iterable<ServerHandle>,
  originalNames: WeakMap<MCPTool, string>,
): { map: Map<string, McpToolNameRef>; ambiguous: Set<string> } {
  const map = new Map<string, McpToolNameRef>();
  const ambiguous = new Set<string>();
  for (const handle of handles) {
    for (const tool of handle.tools) {
      const ref = {
        serverKey: handle.serverKey,
        originalName: originalNames.get(tool) ?? tool.name,
      };
      for (const name of [tool.name, ...(tool.aliases ?? [])]) {
        if (ambiguous.has(name)) continue;
        const existing = map.get(name);
        if (!existing) {
          map.set(name, ref);
          continue;
        }
        if (existing.serverKey !== ref.serverKey || existing.originalName !== ref.originalName) {
          map.delete(name);
          ambiguous.add(name);
        }
      }
    }
  }
  return { map, ambiguous };
}
