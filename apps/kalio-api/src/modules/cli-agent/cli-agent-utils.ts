const MAX_TIMEOUT_MS = 1_200_000;
const SLOW_AGENT_MIN_TIMEOUT_MS = 180_000;
const SLOW_AGENT_IDS = new Set(['gemini', 'codex']);
export const EXIT_FALLBACK_GRACE_MS = 250;
const WINDOWS_POWERSHELL_EXE = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';

export function normalizeTimeoutMs(agentId: string, timeoutMs: number): number {
  const cappedTimeout = Math.min(timeoutMs, MAX_TIMEOUT_MS);
  if (SLOW_AGENT_IDS.has(agentId)) {
    return Math.max(cappedTimeout, SLOW_AGENT_MIN_TIMEOUT_MS);
  }
  return cappedTimeout;
}

export function quotePowerShellArg(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function parseJsonLine(line: string): unknown | null {
  try {
    return JSON.parse(line) as unknown;
  } catch {
    return null;
  }
}

export function extractCodexAgentMessage(output: string): string | null {
  let lastMessage: string | null = null;
  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) {
      continue;
    }

    const parsed = parseJsonLine(trimmed);
    if (!parsed || typeof parsed !== 'object') {
      continue;
    }

    const event = parsed as { type?: unknown; item?: unknown };
    if (event.type !== 'item.completed' || !event.item || typeof event.item !== 'object') {
      continue;
    }

    const item = event.item as { type?: unknown; text?: unknown };
    if (item.type === 'agent_message' && typeof item.text === 'string') {
      lastMessage = item.text;
    }
  }

  return lastMessage?.trim() || null;
}

export { WINDOWS_POWERSHELL_EXE };
