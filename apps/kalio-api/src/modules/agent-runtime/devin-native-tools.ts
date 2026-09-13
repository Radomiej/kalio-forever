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
  kind?: string | null;
  name?: string | null;
  title?: string | null;
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
