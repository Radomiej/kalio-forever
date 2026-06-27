import type { MCPTool } from '@kalio/types';

// TODO: legacy fallback - keep accepting serverId while MCP tools and clients finish the one-release migration window.
type MCPToolServerKeyLike = {
  serverKey?: MCPTool['serverKey'];
  serverId?: MCPTool['serverId'];
};

export function getCanonicalMcpToolServerKey(tool: MCPToolServerKeyLike): string {
  return tool.serverKey ?? tool.serverId ?? '';
}

export function toolBelongsToServerKey(tool: MCPToolServerKeyLike, serverKey: string): boolean {
  return getCanonicalMcpToolServerKey(tool) === serverKey;
}
