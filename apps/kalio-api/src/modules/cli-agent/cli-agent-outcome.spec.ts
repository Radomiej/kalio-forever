import { describe, expect, it } from 'vitest';
import { applySemanticCliOutcome } from './cli-agent-outcome';

describe('applySemanticCliOutcome', () => {
  it('honors typed auth failure code without parsing output text', () => {
    expect(applySemanticCliOutcome({
      agentId: 'codex',
      output: 'Provider returned a structured authentication failure.',
      exitCode: 0,
      durationMs: 10,
      failureCode: 'auth_required',
    })).toMatchObject({
      rawExitCode: 0,
      exitCode: 1,
      outcome: 'failed',
      failureCode: 'auth_required',
    });
  });

  it('does not infer auth failure from successful output text', () => {
    const result = applySemanticCliOutcome({
      agentId: 'codex',
      output: 'Documented codex login instructions for local setup.',
      exitCode: 0,
      durationMs: 10,
    });

    expect(result).toMatchObject({
      rawExitCode: 0,
      exitCode: 0,
      outcome: 'completed',
    });
    expect(result.failureCode).toBeUndefined();
  });

  it('does not infer auth failure from non-zero output text without a typed failure code', () => {
    const result = applySemanticCliOutcome({
      agentId: 'codex',
      output: 'Please run codex login before retrying.',
      exitCode: 1,
      durationMs: 10,
    });

    expect(result).toMatchObject({
      rawExitCode: 1,
      exitCode: 1,
      outcome: 'failed',
    });
    expect(result.failureCode).toBeUndefined();
  });
});
