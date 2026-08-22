import { describe, expect, it } from 'vitest';
import { resolveExecutionProfileId } from './execution-profile.utils';

describe('resolveExecutionProfileId', () => {
  it('prefers an explicit profile, then persona, then project default', () => {
    expect(resolveExecutionProfileId({
      explicitProfileId: 'explicit',
      personaProfileId: 'persona',
      projectProfileId: 'project',
    })).toBe('explicit');

    expect(resolveExecutionProfileId({
      personaProfileId: 'persona',
      projectProfileId: 'project',
    })).toBe('persona');

    expect(resolveExecutionProfileId({ projectProfileId: 'project' })).toBe('project');
  });

  it('rejects a session that has no execution profile', () => {
    expect(() => resolveExecutionProfileId({})).toThrow('Execution profile is required');
  });
});
