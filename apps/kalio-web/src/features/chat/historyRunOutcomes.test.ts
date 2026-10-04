import { expect, it } from 'vitest';
import type { ChatRunSnapshot } from '@kalio/types';
import type { AgentTurn } from '../../store/sessionStore';
import { applyHistoryRunOutcomes } from './historyRunOutcomes';

const turn: AgentTurn = { id: 'turn', sessionId: 'session', done: true, items: [{ kind: 'text', messageId: 'partial' }] };
const run: ChatRunSnapshot = { id: 'run', sessionId: 'session', turnId: 'turn', phase: 'interrupted',
  status: 'cancelled', retryCount: 0, safeResume: false, startedAt: 1, updatedAt: 2, lastHeartbeatAt: 2 };

it('restores a stopped label for the exact durable cancelled turn without losing partial content', () => {
  expect(applyHistoryRunOutcomes([turn], [run])[0]).toEqual({ ...turn, error: { code: 'CANCELLED', message: 'Stopped by user' } });
});
it('never assigns another session or turn outcome', () => {
  expect(applyHistoryRunOutcomes([turn], [{ ...run, sessionId: 'other' }, { ...run, turnId: 'other' }])[0]).toBe(turn);
});
it('does not relabel successful or active turns', () => {
  for (const status of ['completed', 'active', 'waiting_for_human'] as const) {
    expect(applyHistoryRunOutcomes([turn], [{ ...run, status }])[0]).toBe(turn);
  }
});
it('latest persisted revision wins regardless of response order', () => {
  const completed = { ...run, status: 'completed' as const, revision: 2 };
  expect(applyHistoryRunOutcomes([turn], [completed, { ...run, revision: 1 }])[0]).toBe(turn);
});
