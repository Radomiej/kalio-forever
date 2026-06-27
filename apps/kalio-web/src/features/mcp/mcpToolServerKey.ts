import type { MCPTool } from '@kalio/types';

// TODO: legacy fallback - keep accepting serverId while MCP tools and clients finish the one-release migration window.
export function getCanonicalMcpToolServerKey(tool: Pick<MCPTool, 'serverKey' | 'serverId'>): string {
  return tool.serverKey ?? tool.serverId;
}

export function toolBelongsToServerKey(tool: Pick<MCPTool, 'serverKey' | 'serverId'>, serverKey: string): boolean {
  return getCanonicalMcpToolServerKey(tool) === serverKey;
}
