import type { CLIAgentResult } from '@kalio/types';

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
    : undefined;
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
