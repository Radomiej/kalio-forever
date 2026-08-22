import { describe, expect, it } from 'vitest';
import type { ExecutionProfile } from '@kalio/types';
import { nativeModelOptions, nativeReasoningOptions } from './persona-runtime-selection';

function profile(overrides: Partial<ExecutionProfile>): ExecutionProfile {
  return {
    id: 'profile',
    name: 'Profile',
    kind: 'codex-app-server',
    model: 'gpt-5.4',
    approvalMode: 'codex_guard',
    enabled: true,
    capabilitiesVersion: '1',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe('persona runtime selection', () => {
  it('deduplicates native models and prefers the strict profile', () => {
    const options = nativeModelOptions([
      profile({ id: 'codex-guard', name: 'Codex Guard' }),
      profile({ id: 'codex-strict', name: 'Codex Strict', approvalMode: 'kalio_strict' }),
      profile({ id: 'codex-luna', model: 'gpt-5.6-luna', reasoningEffort: 'max' }),
    ], 'codex-app-server');

    expect(options.map((option) => option.model)).toEqual(['gpt-5.4', 'gpt-5.6-luna']);
    expect(options[0]?.profile.id).toBe('codex-strict');
  });

  it('limits reasoning choices to the selected model', () => {
    const profiles = [
      profile({ id: 'codex-default', reasoningEffort: undefined }),
      profile({ id: 'codex-max', reasoningEffort: 'max' }),
      profile({ id: 'codex-luna', model: 'gpt-5.6-luna', reasoningEffort: 'max' }),
    ];

    expect(nativeReasoningOptions(profiles, 'codex-app-server', 'gpt-5.4')).toEqual(['', 'max']);
    expect(nativeReasoningOptions(profiles, 'codex-app-server', 'gpt-5.6-luna')).toEqual(['max']);
  });
});
