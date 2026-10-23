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
 * native filesystem/web/terminal policy; the caller separately gates it on
 * the configured bridge and the effective Kalio tool allowlist.
 */
export function isKalioMcpToolCall(toolCall: DevinNativeToolCall, serverName: string, allowedToolNames: readonly string[]): boolean {
  return getKalioMcpToolName(toolCall, serverName, allowedToolNames) !== undefined;
}

export function getKalioMcpToolName(
  toolCall: DevinNativeToolCall,
  serverName: string,
  allowedToolNames: readonly string[],
): string | undefined {
  const input = isRecord(toolCall.rawInput) ? toolCall.rawInput : undefined;
  if (toolCall.rawInput !== undefined && toolCall.rawInput !== null && !input) return undefined;
  if (toolCall.name !== undefined && toolCall.name !== null && toolCall.name !== 'mcp_call_tool') return undefined;

  const titleToolName = allowedToolNames.find((toolName) => toolCall.title === `Calling ${toolName} from ${serverName}`);
  if (input) {
    if ('server' in input && input.server !== serverName) return undefined;
    if (
      'tool' in input
      && (
        typeof input.tool !== 'string'
        || !allowedToolNames.includes(input.tool)
        || (titleToolName !== undefined && input.tool !== titleToolName)
      )
    ) {
      return undefined;
    }
    if (
      toolCall.name === 'mcp_call_tool'
      && input.server === serverName
      && typeof input.tool === 'string'
      && allowedToolNames.includes(input.tool)
    ) {
      return input.tool;
    }
  } else if (toolCall.name === 'mcp_call_tool') {
    return undefined;
  }

  // TODO: legacy fallback: Devin ACP may omit the wrapper name and supplies `rawInput` as tool arguments; require an exact allowlisted title and reject conflicting server/tool fields.
  return titleToolName;
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
