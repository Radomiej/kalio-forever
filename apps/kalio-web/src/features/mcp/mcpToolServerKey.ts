import type { MCPTool } from '@kalio/types';

type MCPToolServerKeyLike = {
  serverKey?: MCPTool['serverKey'];
  serverId?: MCPTool['serverId'];
};

export function getCanonicalMcpToolServerKey(tool: MCPToolServerKeyLike): string {
  return tool.serverKey ?? '';
}

export function toolBelongsToServerKey(tool: MCPToolServerKeyLike, serverKey: string): boolean {
  return tool.serverKey === serverKey;
}
