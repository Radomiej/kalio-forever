import type { MCPTool } from '@kalio/types';
import { parseServerKey } from './mcp-registry.utils';

interface MCPToolDiscoveryResult {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

interface MCPStatusHandle {
  serverKey: string;
  name: string;
  status: string;
  tools: MCPTool[];
  lastError?: string;
}

export function buildLegacyMcpToolName(serverKey: string, originalName: string): string | null {
  const parsed = parseServerKey(serverKey);
  if (!parsed) {
    return null;
  }

  return `mcp_${parsed.id}_${originalName}`;
}

export function buildMcpToolPayload(serverKey: string, tool: MCPToolDiscoveryResult): MCPTool {
  return {
    name: `mcp_${serverKey}_${tool.name}`,
    description: tool.description ?? '',
    parameters: (tool.inputSchema ?? {}) as Record<string, unknown>,
    requiresConfirmation: false,
    serverKey,
    serverId: serverKey,
  } satisfies MCPTool;
}

export function buildMcpServerStatusPayload(handle: MCPStatusHandle): {
  serverId: string;
  serverKey: string;
  serverName: string;
  status: string;
  toolCount: number;
  lastError?: string;
} {
  return {
    serverId: handle.serverKey,
    serverKey: handle.serverKey,
    serverName: handle.name,
    status: handle.status,
    toolCount: handle.tools.length,
    lastError: handle.lastError,
  };
}
