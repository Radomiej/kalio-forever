import { createHash } from 'node:crypto';
import type { MCPTool } from '@kalio/types';

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

export function buildMcpToolName(serverKey: string, toolName: string): string {
  const digest = createHash('sha256')
    .update(`${serverKey}\0${toolName}`)
    .digest('hex')
    .slice(0, 8);
  const fragment = `${serverKey}_${toolName}`
    .replace(/[^A-Za-z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 51) || 'tool';
  return `mcp_${fragment}_${digest}`;
}

export function buildMcpToolPayload(serverKey: string, tool: MCPToolDiscoveryResult): MCPTool {
  const legacyCanonicalName = `mcp_${serverKey}_${tool.name}`;
  return {
    name: buildMcpToolName(serverKey, tool.name),
    description: tool.description ?? '',
    parameters: (tool.inputSchema ?? {}) as Record<string, unknown>,
    requiresConfirmation: false,
    serverKey,
    serverId: serverKey,
    aliases: [legacyCanonicalName, `mcp_${tool.name}`],
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
