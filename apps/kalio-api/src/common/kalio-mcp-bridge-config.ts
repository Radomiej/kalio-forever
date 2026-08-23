export interface KalioMcpBridgeHttpConfig {
  type: 'http';
  name: 'kalio';
  url: string;
  headers: Array<{ name: string; value: string }>;
}

export interface KalioMcpBridgeContext {
  sessionId: string;
  vfsSessionId?: string;
  turnId?: string;
  promptMessageId?: string;
  allowedToolNames?: readonly string[];
}

export function kalioMcpBridgeUrl(): string {
  const port = parsePort(process.env['PORT']);
  return `http://127.0.0.1:${port}/api/mcp/bridge`;
}

export function isKalioMcpBridgeEnabled(): boolean {
  return Boolean(process.env['KALIO_MCP_BRIDGE_TOKEN']?.trim());
}

export function buildKalioMcpBridgeHttpConfig(
  context: KalioMcpBridgeContext,
): KalioMcpBridgeHttpConfig | null {
  const token = process.env['KALIO_MCP_BRIDGE_TOKEN']?.trim();
  if (!token) return null;

  const headers: Array<{ name: string; value: string }> = [
    { name: 'Authorization', value: `Bearer ${token}` },
    { name: 'x-kalio-session-id', value: context.sessionId },
  ];
  addHeader(headers, 'x-kalio-vfs-session-id', context.vfsSessionId);
  addHeader(headers, 'x-kalio-turn-id', context.turnId);
  addHeader(headers, 'x-kalio-prompt-message-id', context.promptMessageId);
  if (context.allowedToolNames) {
    headers.push({ name: 'x-kalio-tool-names', value: context.allowedToolNames.join(',') });
  }

  return { type: 'http', name: 'kalio', url: kalioMcpBridgeUrl(), headers };
}

function addHeader(headers: Array<{ name: string; value: string }>, name: string, value: string | undefined): void {
  if (value?.trim()) headers.push({ name, value: value.trim() });
}

function parsePort(value: string | undefined): number {
  const port = Number.parseInt(value ?? '', 10);
  return Number.isInteger(port) && port > 0 && port < 65_536 ? port : 3016;
}
