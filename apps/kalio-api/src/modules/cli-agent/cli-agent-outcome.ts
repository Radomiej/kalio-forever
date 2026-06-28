import type { CLIAgentResult } from '@kalio/types';

const GENERAL_CLI_AUTH_REQUIRED_PATTERNS = [
  /\bauthentication required\b/i,
  /\blogin required\b/i,
  /\bnot logged in\b/i,
  /\bsign in required\b/i,
] as const;

const CLI_AUTH_REQUIRED_PATTERNS: Record<string, readonly RegExp[]> = {
  claude: [
    /\bplease run\s+\/login\b/i,
    /\bclaude(?:\s+code)?\b.*\b(authenticate|authentication required|login required|not logged in)\b/i,
  ],
  copilot: [
    /\bplease run\s+gh\s+auth\s+login\b/i,
    /\bgithub\s+copilot\b.*\b(authenticate|authentication required|login required|not logged in)\b/i,
  ],
  codex: [
    /\bplease sign in\b/i,
    /\bplease run\s+`?codex\s+login`?\b/i,
    /\bcodex\b.*\b(authentication required|login required|not logged in|sign in)\b/i,
  ],
  gemini: [
    /\bplease run\s+`?gemini\s+auth\s+login`?\b/i,
    /\bgemini\b.*\b(authentication required|login required|not logged in|sign in)\b/i,
  ],
};

export type CLIAgentSemanticFailureCode = 'auth_required';

export interface CLIAgentRunResult extends CLIAgentResult {
  rawExitCode: number;
  outcome: 'completed' | 'failed';
  failureCode?: CLIAgentSemanticFailureCode;
}

export function applySemanticCliOutcome(
  result: (CLIAgentResult & { failureCode?: CLIAgentSemanticFailureCode }) | CLIAgentRunResult,
): CLIAgentRunResult {
  if ('rawExitCode' in result && 'outcome' in result) {
    return result;
  }

  const rawExitCode = result.exitCode;
  const failureCode = isSemanticFailureCode(result.failureCode)
    ? result.failureCode
    // TODO: legacy fallback for adapters that still expose auth failures only through non-zero CLI output.
    : rawExitCode === 0
      ? undefined
      : detectSemanticFailureCode(result.agentId, result.output);
  const outcome = rawExitCode === 0 && !failureCode ? 'completed' : 'failed';

  return {
    ...result,
    exitCode: outcome === 'completed' ? result.exitCode : (result.exitCode === 0 ? 1 : result.exitCode),
    rawExitCode,
    outcome,
    ...(failureCode ? { failureCode } : {}),
  };
}

function isSemanticFailureCode(value: unknown): value is CLIAgentSemanticFailureCode {
  return value === 'auth_required';
}

function detectSemanticFailureCode(
  agentId: string,
  output: string,
): CLIAgentSemanticFailureCode | undefined {
  const authWindow = output
    .slice(0, 2_000)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, 8);
  if (authWindow.length === 0) {
    return undefined;
  }

  const agentPatterns = CLI_AUTH_REQUIRED_PATTERNS[agentId] ?? [];
  return authWindow.some((line) => [...GENERAL_CLI_AUTH_REQUIRED_PATTERNS, ...agentPatterns].some((pattern) => pattern.test(line)))
    ? 'auth_required'
    : undefined;
}
