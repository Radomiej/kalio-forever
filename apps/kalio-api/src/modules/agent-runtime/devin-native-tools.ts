export const DEVIN_NATIVE_TOOL_CATEGORIES = ['filesystem', 'web', 'terminal'] as const;

export type DevinNativeToolCategory = (typeof DEVIN_NATIVE_TOOL_CATEGORIES)[number];

export interface DevinNativeToolsPolicy {
  filesystem: boolean;
  web: boolean;
  terminal: boolean;
  source: 'settings' | 'default';
}

export const DEFAULT_DEVIN_NATIVE_TOOLS_POLICY: DevinNativeToolsPolicy = {
  filesystem: false,
  web: false,
  terminal: false,
  source: 'default',
};

export interface DevinNativeToolCall {
  toolCallId?: string | null;
  kind?: string | null;
  name?: string | null;
  title?: string | null;
  rawInput?: unknown;
}

/**
 * Devin ACP exposes MCP calls through a provider wrapper instead of exposing
 * each server tool as a first-class ACP tool. Keep that wrapper outside the
 * native filesystem/web/terminal policy; Kalio enforces the actual tool scope
 * and HITL decision after the MCP call reaches the bridge.
 */
export function isKalioMcpToolCall(toolCall: DevinNativeToolCall, serverName = 'kalio'): boolean {
  const name = toolCall.name?.trim().toLowerCase() ?? '';
  const toolCallId = toolCall.toolCallId?.trim().toLowerCase() ?? '';
  const wrapperName = name === 'mcp_call_tool' || toolCallId.includes('mcp_call_tool');
  const normalizedServerName = serverName.trim().toLowerCase();
  const input = isRecord(toolCall.rawInput) ? toolCall.rawInput : undefined;
  const server = readString(input?.server) ?? readString(input?.serverName);
  if (server && server.toLowerCase() === normalizedServerName) return true;
  if (server) return false;

  const titleMatch = toolCall.title?.trim().match(/^(?:calling|called)\s+(.+?)\s+from\s+(.+?)\s*$/i);
  const titleServer = titleMatch?.[2]?.trim().toLowerCase();
  if (titleServer !== normalizedServerName) return false;
  if (wrapperName || toolCallId.includes('mcp')) return true;

  // Devin 3000.5 reports a permission request for an MCP tool by its real
  // name, while the title carries the server identity (for example,
  // "Calling vfs_list from kalio-runtime").
  const titleTool = titleMatch?.[1]?.trim().toLowerCase();
  return Boolean(titleTool && (!name || name === titleTool));
}

export function classifyDevinNativeTool(toolCall: DevinNativeToolCall): DevinNativeToolCategory | undefined {
  const kind = toolCall.kind?.toLowerCase() ?? '';
  const label = `${toolCall.name ?? ''} ${toolCall.title ?? ''}`.toLowerCase();
  if (kind === 'read' || kind === 'edit' || kind === 'delete' || kind === 'move') return 'filesystem';
  if (kind === 'execute') return 'terminal';
  if (kind === 'fetch') return 'web';
  if (kind === 'search') return isWebLabel(label) ? 'web' : 'filesystem';
  if (/(https?:\/\/|browser|web|network|url|fetch|search online)/i.test(label)) return 'web';
  if (/(terminal|shell|command|exec|powershell|bash|npm|pnpm|git)/i.test(label)) return 'terminal';
  if (/(file|path|directory|folder|workspace|read|write|edit|delete|move)/i.test(label)) return 'filesystem';
  return undefined;
}

function isWebLabel(value: string): boolean {
  return /(https?:\/\/|browser|web|network|url|fetch|online)/i.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
