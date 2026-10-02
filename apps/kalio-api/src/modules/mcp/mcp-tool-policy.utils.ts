import type { ServerHandle } from './mcp-runtime.utils';

type ToolPolicy = Pick<ServerHandle, 'enabledTools' | 'disabledTools'>;

export function isMcpToolEnabled(toolName: string, policy?: ToolPolicy): boolean {
  if (policy?.disabledTools?.includes(toolName)) return false;
  return policy?.enabledTools === undefined || policy.enabledTools.includes(toolName);
}

export function filterMcpToolDiscoveries<T extends { name: string }>(
  tools: T[],
  policy?: ToolPolicy,
): T[] {
  return tools.filter((tool) => isMcpToolEnabled(tool.name, policy));
}

export function callMcpTool(
  handle: ServerHandle,
  toolName: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  if (!isMcpToolEnabled(toolName, handle)) {
    throw new Error(`MCP tool ${toolName} is not enabled for server ${handle.serverKey}`);
  }
  return handle.client.callTool({ name: toolName, arguments: args });
}

export function sameMcpHandleConfig(left: ServerHandle, right: ServerHandle): boolean {
  return left.signature === right.signature
    && left.serverKey === right.serverKey
    && JSON.stringify(left.envVars ?? {}) === JSON.stringify(right.envVars ?? {})
    && JSON.stringify(left.headers ?? {}) === JSON.stringify(right.headers ?? {})
    && JSON.stringify(normalizeToolList(left.enabledTools)) === JSON.stringify(normalizeToolList(right.enabledTools))
    && JSON.stringify(normalizeToolList(left.disabledTools)) === JSON.stringify(normalizeToolList(right.disabledTools));
}

function normalizeToolList(tools: string[] | undefined): string[] | undefined {
  return tools === undefined ? undefined : [...tools].sort();
}
