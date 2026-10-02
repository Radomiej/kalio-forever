import { describe, expect, it } from 'vitest';
import type { ExecutionProfile } from '@kalio/types';
import { resolveLaunchExecutionProfileId } from './useLaunchPersonas';

const profile = (id: string): ExecutionProfile => ({
  id,
  name: id,
  kind: 'devin-cli-acp',
  model: 'swe-2',
  approvalMode: 'kalio_strict',
  enabled: true,
  capabilitiesVersion: '1',
  createdAt: 1,
  updatedAt: 1,
});

describe('resolveLaunchExecutionProfileId', () => {
  it('keeps an existing conversation choice, otherwise seeds from the selected persona recommendation', () => {
    const profiles = [profile('chat-choice'), profile('persona-recommendation')];
    expect(resolveLaunchExecutionProfileId('chat-choice', 'persona-recommendation', profiles)).toBe('chat-choice');
    expect(resolveLaunchExecutionProfileId('unavailable', 'persona-recommendation', profiles)).toBe('persona-recommendation');
  });

  it('requires an explicit choice when neither saved nor recommended profile is available', () => {
    expect(resolveLaunchExecutionProfileId(undefined, 'missing-profile', [])).toBe('');
  });
});
