import { describe, expect, it } from 'vitest';
import { isCompletedCliChildStatus, mergeChildAgentStatus } from './architecture-cli-child-status';

describe('architecture CLI child status helpers', () => {
  it.each(['completed', 'success', 'exited'] as const)(
    'treats %s as completed CLI child status',
    (status) => {
      expect(isCompletedCliChildStatus(status)).toBe(true);
    },
  );

  it.each([undefined, 'unknown', 'running', 'failed', 'stopped'] as const)(
    'treats %s as unresolved CLI child status',
    (status) => {
      expect(isCompletedCliChildStatus(status)).toBe(false);
    },
  );

  it('preserves terminal live status over stale persisted non-terminal overlays', () => {
    expect(mergeChildAgentStatus('completed', 'running')).toBe('completed');
    expect(mergeChildAgentStatus('failed', 'unknown')).toBe('failed');
    expect(mergeChildAgentStatus('stopped', 'running')).toBe('stopped');
  });

  it.each(['completed', 'failed', 'stopped'] as const)(
    'preserves %s when a stale overlay reports unknown',
    (status) => {
      expect(mergeChildAgentStatus(status, 'unknown')).toBe(status);
    },
  );
});
