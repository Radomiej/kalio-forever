import { describe, expect, it } from 'vitest';
import type { AuditLogEntry } from '@kalio/types';
import { recordedTurnModel, withRecordedTurnModels } from './executionGraphTurnModels';
import { buildExecutionGraphModel } from './executionGraphModel';

function entry(sessionId: string, turnId: string, model: unknown, createdAt = 1): AuditLogEntry {
  return { id: `${sessionId}:${turnId}:${createdAt}`, sessionId, type: 'runtime_event',
    label: 'llm.turn.started', data: { turnId, model }, createdAt, durationMs: null, chunkCount: null };
}

describe('recordedTurnModel', () => {
  it('shows loading rather than unavailable before identity evidence settles', () => {
    const model = buildExecutionGraphModel({ sessionId: 'session', messages: [],
      turns: [{ id: 'turn', sessionId: 'session', done: true, items: [] }],
      toolActivities: [], activeAgentLoops: {}, sessions: [], sessionMessages: {} });
    const pending = withRecordedTurnModels(model, [], [], [], true);
    expect(pending.nodes.find(node => node.payload.kind === 'turn')?.detail).toContain('Loading runtime model');
    expect(pending.nodes.find(node => node.payload.kind === 'turn')?.detail).not.toContain('unavailable');
    const settled = withRecordedTurnModels(model, [], [], [], false);
    expect(settled.nodes.find(node => node.payload.kind === 'turn')?.detail).toContain('Runtime model unavailable');
  });
  it('does not label a terminal error as completed when hydrating the runtime model', () => {
    const model = buildExecutionGraphModel({ sessionId: 'session', messages: [],
      turns: [{ id: 'turn', sessionId: 'session', done: true, error: { code: 'TOOL_ERROR', message: 'Failed' }, items: [] }],
      toolActivities: [], activeAgentLoops: {}, sessions: [], sessionMessages: {} });
    const hydrated = withRecordedTurnModels(model, [entry('session', 'turn', 'swe-2')], [], []);
    const turn = hydrated.nodes.find(node => node.payload.kind === 'turn');
    expect(turn?.status).toBe('error');
    expect(turn?.detail).toBe('Turn ended with errors');
    expect(turn?.payload.kind === 'turn' && turn.payload.modelLabel).toBe('swe-2');
  });
  it.each(['CANCELLED', 'INTERRUPTED'])('distinguishes %s from a failed turn after model hydration', (code) => {
    const model = buildExecutionGraphModel({ sessionId: 'session', messages: [],
      turns: [{ id: 'turn', sessionId: 'session', done: true, error: { code, message: 'Stopped' }, items: [] }],
      toolActivities: [], activeAgentLoops: {}, sessions: [], sessionMessages: {} });
    const hydrated = withRecordedTurnModels(model, [entry('session', 'turn', 'swe-2')], [], []);
    expect(hydrated.nodes.find(node => node.payload.kind === 'turn')?.detail).toBe('Turn interrupted');
  });
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
