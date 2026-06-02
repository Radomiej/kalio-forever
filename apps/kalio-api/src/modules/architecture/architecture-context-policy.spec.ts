import { describe, expect, it } from 'vitest';
import {
  cloneArchitectureContextPolicy,
  isArchitectureContextPolicy,
} from './architecture-context-policy';

describe('architecture-context-policy', () => {
  it('clones per-slot overrides without sharing nested references', () => {
    const original = {
      includeUserTask: true,
      includeProjectMemory: false,
      includeBrowserSession: true,
      includePriorDecisions: false,
      includeOtherAgentOutputs: true,
      perSlotOverrides: {
        router: {
          includeToolResults: true,
          contextCompression: 'summary' as const,
        },
      },
    };

    const clone = cloneArchitectureContextPolicy(original);
    clone.perSlotOverrides!.router.includeToolResults = false;

    expect(original.perSlotOverrides?.router.includeToolResults).toBe(true);
    expect(clone).toEqual({
      ...original,
      perSlotOverrides: {
        router: {
          includeToolResults: false,
          contextCompression: 'summary',
        },
      },
    });
  });

  it('accepts valid policies and rejects invalid per-slot overrides', () => {
    const valid = {
      includeUserTask: true,
      includeProjectMemory: false,
      includeBrowserSession: false,
      includePriorDecisions: true,
      includeToolResults: true,
      contextCompression: 'evidence_only',
      perSlotOverrides: {
        critic: {
          includeUserTask: false,
          contextCompression: 'none',
        },
      },
    };

    const invalid = {
      ...valid,
      perSlotOverrides: {
        critic: {
          includeUserTask: false,
          contextCompression: 'aggressive',
        },
      },
    };

    expect(isArchitectureContextPolicy(valid)).toBe(true);
    expect(isArchitectureContextPolicy(invalid)).toBe(false);
  });
});
