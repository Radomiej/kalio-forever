import { describe, expect, it } from 'vitest';
import type { ChatMessage, ChatRunSnapshot } from '@kalio/types';
import type { AgentTurn } from '../../store/sessionStore';
import { applyHistoryRunOutcomes } from './historyRunOutcomes';

const prompt: ChatMessage = { id: 'prompt', sessionId: 'session', role: 'user', turnId: 'turn', content: 'Hello', createdAt: 1 };
const run: ChatRunSnapshot = { id: 'run', sessionId: 'session', turnId: 'turn', phase: 'failed', status: 'failed',
  retryCount: 0, safeResume: false, startedAt: 1, updatedAt: 2, lastHeartbeatAt: 2, revision: 1,
  errorCode: 'LLM_ERROR', errorMessage: 'Unavailable' };

const turn: AgentTurn = { id: 'turn', sessionId: 'session', done: true, items: [{ kind: 'text', messageId: 'partial' }] };
const cancelledRun: ChatRunSnapshot = { id: 'run', sessionId: 'session', turnId: 'turn', phase: 'interrupted',
  status: 'cancelled', retryCount: 0, safeResume: false, startedAt: 1, updatedAt: 2, lastHeartbeatAt: 2 };

it('preserves the exact historical runtime provider on successful turns', () => {
  const result = applyHistoryRunOutcomes([turn], [{ ...run, status: 'completed', provider: 'codex-app-server' }]);
  expect(result[0]).toEqual({ ...turn, runtimeProvider: 'codex-app-server' });
  expect(turn).not.toHaveProperty('runtimeProvider');
  expect(applyHistoryRunOutcomes([turn], [{ ...run, sessionId: 'other', provider: 'devin-cli-acp' }])[0]).toBe(turn);
});

it('restores a stopped label for the exact durable cancelled turn without losing partial content', () => {
  expect(applyHistoryRunOutcomes([turn], [cancelledRun])[0]).toEqual({ ...turn, error: { code: 'CANCELLED', message: 'Stopped by user' } });
});
it('never assigns another session or turn outcome', () => {
  expect(applyHistoryRunOutcomes([turn], [{ ...cancelledRun, sessionId: 'other' }, { ...cancelledRun, turnId: 'other' }])[0]).toBe(turn);
});
it('does not relabel successful or active turns', () => {
  for (const status of ['completed', 'active', 'waiting_for_human'] as const) {
    expect(applyHistoryRunOutcomes([turn], [{ ...cancelledRun, status }])[0]).toBe(turn);
  }
});
it('latest persisted revision wins regardless of response order', () => {
  const completed = { ...cancelledRun, status: 'completed' as const, revision: 2 };
  expect(applyHistoryRunOutcomes([turn], [completed, { ...cancelledRun, revision: 1 }])[0]).toBe(turn);
});

describe('user-only durable run outcome projection', () => {
  it.each(['active', 'queued', 'completed', 'waiting_for_human'] as const)('does not fabricate a terminal bubble for %s', status => {
    expect(applyHistoryRunOutcomes([], [{ ...run, status }], [prompt])).toEqual([]);
  });
  it('ignores another session and architecture runtime outcomes', () => {
    expect(applyHistoryRunOutcomes([], [{ ...run, sessionId: 'other' }], [prompt])).toEqual([]);
    expect(applyHistoryRunOutcomes([], [{ ...run, runtimeKind: 'agent-flow-branch' }], [prompt])).toEqual([]);
  });
  it('honors the newest revision instead of a stale failure', () => {
    expect(applyHistoryRunOutcomes([], [run, { ...run, revision: 2, status: 'completed' }], [prompt])).toEqual([]);
  });
  it('does not duplicate a partial assistant turn or mutate its content items', () => {
    const turn = { id: 'turn', sessionId: 'session', promptMessageId: 'prompt', items: [{ kind: 'text' as const, messageId: 'assistant' }], done: true };
    const result = applyHistoryRunOutcomes([turn], [run], [prompt]);
    expect(result).toHaveLength(1);
    expect(result[0].items).toEqual(turn.items);
    expect(result[0].error).toEqual({ code: 'LLM_ERROR', message: 'Unavailable' });
    expect(turn).not.toHaveProperty('error');
  });
  it('places the missing error turn before a later assistant turn using durable prompt order', () => {
    const later = { ...prompt, id: 'later-prompt', turnId: 'later-turn', createdAt: 3 };
    const turn = { id: 'later-turn', sessionId: 'session', promptMessageId: later.id, items: [], done: true };
    expect(applyHistoryRunOutcomes([turn], [run], [prompt, later]).map(item => item.id)).toEqual(['turn', 'later-turn']);
  });
});
