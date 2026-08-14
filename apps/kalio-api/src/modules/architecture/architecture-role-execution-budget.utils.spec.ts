import { describe, expect, it } from 'vitest';
import {
  architectureRoleTimeoutMs,
  architectureRoleMaxIterations,
  maxArchitectureSubagentTimeoutMsFromContext,
  maxArchitectureSubagentIterationsFromContext,
} from './architecture-role-execution-budget.utils';

describe('architecture role execution budget helpers', () => {
  it('defaults subagent timeout to 300 seconds when no override exists', () => {
    expect(architectureRoleTimeoutMs({
      slotId: 'researcher',
      context: undefined,
    })).toBe(300_000);
  });

  it('prefers per-slot timeout over global timeout context', () => {
    expect(maxArchitectureSubagentTimeoutMsFromContext({
      slotId: 'implementer',
      context: {
        maxArchitectureSubagentTimeoutMs: 60_000,
        maxArchitectureSubagentTimeoutMsBySlot: {
          implementer: 900_000,
        },
      },
    })).toBe(900_000);
  });

  it('ignores invalid timeout context values instead of coercing them', () => {
    expect(maxArchitectureSubagentTimeoutMsFromContext({
      slotId: 'implementer',
      context: {
        maxArchitectureSubagentTimeoutMs: '300000',
        maxArchitectureSubagentTimeoutMsBySlot: {
          implementer: 9_999,
        },
      },
    })).toBeUndefined();

    expect(maxArchitectureSubagentTimeoutMsFromContext({
      slotId: 'implementer',
      context: {
        maxArchitectureSubagentTimeoutMs: 1_200_001,
      },
    })).toBeUndefined();
  });

  it('defaults subagent max iterations to 30 when no override exists', () => {
    expect(architectureRoleMaxIterations({
      slotId: 'researcher',
      context: undefined,
    })).toBe(30);
  });

  it('prefers per-slot context budget over global context budget', () => {
    expect(maxArchitectureSubagentIterationsFromContext({
      slotId: 'implementer',
      context: {
        maxArchitectureSubagentIterations: 20,
        maxArchitectureSubagentIterationsBySlot: {
          implementer: 45,
        },
      },
    })).toBe(45);
  });

  it('resolves max iteration overrides in typed priority order', () => {
    expect(architectureRoleMaxIterations({
      slotId: 'implementer',
      context: { maxArchitectureSubagentIterations: 20 },
      globalMaxToolAttempts: 40,
      personaMaxToolAttempts: 60,
      nodeMaxToolAttempts: 80,
    })).toBe(80);

    expect(architectureRoleMaxIterations({
      slotId: 'implementer',
      context: { maxArchitectureSubagentIterations: 20 },
      globalMaxToolAttempts: 40,
      personaMaxToolAttempts: 60,
    })).toBe(60);

    expect(architectureRoleMaxIterations({
      slotId: 'implementer',
      context: { maxArchitectureSubagentIterations: 20 },
      globalMaxToolAttempts: 40,
    })).toBe(20);

    expect(architectureRoleMaxIterations({
      slotId: 'implementer',
      context: undefined,
      globalMaxToolAttempts: 40,
    })).toBe(40);
  });

  it('clamps numeric node persona and global settings to the runtime-safe range', () => {
    expect(architectureRoleMaxIterations({ slotId: 'x', nodeMaxToolAttempts: 0 })).toBe(1);
    expect(architectureRoleMaxIterations({ slotId: 'x', nodeMaxToolAttempts: 101 })).toBe(100);
    expect(architectureRoleMaxIterations({ slotId: 'x', personaMaxToolAttempts: 0 })).toBe(1);
    expect(architectureRoleMaxIterations({ slotId: 'x', personaMaxToolAttempts: 101 })).toBe(100);
    expect(architectureRoleMaxIterations({ slotId: 'x', globalMaxToolAttempts: 0 })).toBe(1);
    expect(architectureRoleMaxIterations({ slotId: 'x', globalMaxToolAttempts: 101 })).toBe(100);
  });

  it('ignores invalid context budgets instead of coercing strings or floats', () => {
    expect(maxArchitectureSubagentIterationsFromContext({
      slotId: 'implementer',
      context: {
        maxArchitectureSubagentIterations: '30',
        maxArchitectureSubagentIterationsBySlot: {
          implementer: 10.5,
        },
      },
    })).toBeUndefined();
  });
});
