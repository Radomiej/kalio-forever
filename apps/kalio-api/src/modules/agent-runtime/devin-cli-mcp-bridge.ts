import { join } from 'node:path';
import type { McpServer } from '@agentclientprotocol/sdk';

export interface DevinCliMcpBridgeContext {
  url: string;
  sessionId: string;
  vfsSessionId?: string;
  allowedToolNames?: readonly string[];
}

const STDIO_PROXY_FILE = join(__dirname, '..', 'mcp-bridge', 'kalio-mcp-bridge-stdio.js');

/**
 * Builds the ACP stdio config used when a Devin host cannot connect to HTTP MCP.
 * The child process is only a transport adapter; authorization and tool policy
 * remain enforced by Kalio's existing HTTP bridge.
 */
export function buildDevinStdioMcpBridgeConfig(
  context: DevinCliMcpBridgeContext,
  token: string,
): McpServer {
  const env = [
    { name: 'KALIO_MCP_BRIDGE_URL', value: context.url },
    { name: 'KALIO_MCP_BRIDGE_TOKEN', value: token },
    { name: 'KALIO_MCP_BRIDGE_SESSION_ID', value: context.sessionId },
    { name: 'KALIO_MCP_BRIDGE_CLIENT', value: 'devin-acp' },
  ];
  addEnv(env, 'KALIO_MCP_BRIDGE_VFS_SESSION_ID', context.vfsSessionId);
  if (context.allowedToolNames) {
    addEnv(env, 'KALIO_MCP_BRIDGE_TOOL_NAMES', context.allowedToolNames.join(','));
  }

  return {
    name: 'kalio',
    command: process.execPath,
    args: [STDIO_PROXY_FILE],
    env,
  };
}

function addEnv(env: Array<{ name: string; value: string }>, name: string, value: string | undefined): void {
  if (value?.trim()) env.push({ name, value: value.trim() });
}
