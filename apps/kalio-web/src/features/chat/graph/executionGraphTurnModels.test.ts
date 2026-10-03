import { describe, expect, it } from 'vitest';
import type { AuditLogEntry } from '@kalio/types';
import { recordedTurnModel } from './executionGraphTurnModels';

function entry(sessionId: string, turnId: string, model: unknown, createdAt = 1): AuditLogEntry {
  return { id: `${sessionId}:${turnId}:${createdAt}`, sessionId, type: 'runtime_event',
    label: 'llm.turn.started', data: { turnId, model }, createdAt, durationMs: null, chunkCount: null };
}

describe('recordedTurnModel', () => {
  it('reads the historical model from the exact session and turn', () => {
    expect(recordedTurnModel([entry('other', 'turn', 'wrong'), entry('session', 'other', 'wrong'),
      entry('session', 'turn', 'swe-2')], 'session', 'turn')).toBe('swe-2');
  });
  it('does not guess from malformed or unrelated audit evidence', () => {
    expect(recordedTurnModel([entry('session', 'turn', 2), entry('session', 'turn', '   '),
      { ...entry('session', 'turn', 'wrong'), label: 'llm.turn.completed' }], 'session', 'turn')).toBeNull();
  });
  it('deduplicates repeated iterations and preserves distinct recorded models in order', () => {
    expect(recordedTurnModel([entry('session', 'turn', 'second', 3), entry('session', 'turn', 'first', 1),
      entry('session', 'turn', 'first', 2)], 'session', 'turn')).toBe('first → second');
  });
});
