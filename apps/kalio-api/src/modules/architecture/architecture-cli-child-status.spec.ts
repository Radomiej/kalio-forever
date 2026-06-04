import { describe, expect, it } from 'vitest';
import { isCompletedCliChildStatus, mergeChildAgentStatus } from './architecture-cli-child-status';
import type { ArchitectureChildAgentProjection } from '@kalio/types';

describe('architecture CLI child status helpers', () => {
  it.each(['completed', 'terminal-success', 'success', 'exited'] as const)(
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

  it.each(['completed', 'terminal-success', 'exited', 'failed', 'stopped'] as const)(
    'preserves %s when a stale overlay reports unknown',
    (status) => {
      expect(mergeChildAgentStatus(status as unknown as ArchitectureChildAgentProjection['status'], 'unknown')).toBe(status);
    },
  );

  it.each(['terminal-success', 'exited', 'completed', 'success'] as const)(
    'preserves terminal completion statuses over stale running overlays',
    (status) => {
      expect(mergeChildAgentStatus(status as unknown as ArchitectureChildAgentProjection['status'], 'running')).toBe(status);
    },
  );
});
