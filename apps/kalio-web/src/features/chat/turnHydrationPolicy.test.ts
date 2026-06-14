import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '@kalio/types';
import type { AgentTurn } from '../../store/sessionStore';
import { shouldReplaceTurnsFromHydratedHistory } from './turnHydrationPolicy';

function makeMessage(overrides: Partial<ChatMessage>): ChatMessage {
  return {
    id: 'message-1',
    sessionId: 'session-1',
    role: 'assistant',
    content: '',
    createdAt: 1,
    ...overrides,
  } as ChatMessage;
}

function makeTurn(overrides: Partial<AgentTurn>): AgentTurn {
  return {
    id: 'turn-1',
    sessionId: 'session-1',
    items: [],
    done: false,
    ...overrides,
  };
}

describe('shouldReplaceTurnsFromHydratedHistory', () => {
  it('keeps a live follow-up workflow turn when hydrated history does not yet contain its prompt', () => {
    const hydratedMessages = [
      makeMessage({ id: 'user-1', role: 'user', content: 'First prompt', createdAt: 1 }),
      makeMessage({
        id: 'arch-old',
        role: 'assistant',
        content: '',
        createdAt: 2,
        architectureRun: {
          runId: 'run-old',
          schemaId: 'strategic-decision-council',
          status: 'completed',
          hostProjectionKind: 'workflow-envelope',
          trace: [],
          routeHops: [],
        },
      }),
      makeMessage({ id: 'user-2', role: 'user', content: 'Follow-up prompt', createdAt: 3 }),
    ];

    const currentTurns = [
      makeTurn({
        id: 'turn-old',
        promptMessageId: 'user-1',
        turnKind: 'workflow-envelope',
        done: true,
        items: [{ kind: 'text', messageId: 'arch-old' }],
      }),
      makeTurn({
        id: 'turn-new',
        promptMessageId: 'user-2',
        turnKind: 'workflow-envelope',
        items: [{ kind: 'text', messageId: 'architecture:user-2:pending' }],
      }),
    ];

    expect(shouldReplaceTurnsFromHydratedHistory({
      sessionId: 'session-1',
      hydratedMessages,
      currentTurns,
      activeTurnId: 'turn-new',
    })).toBe(false);
  });

  it('replaces an empty live placeholder when hydrated workflow history already contains the real envelope turn', () => {
    const hydratedMessages = [
      makeMessage({ id: 'user-1', role: 'user', content: 'Assess repo', createdAt: 1 }),
      makeMessage({
        id: 'arch-1',
        role: 'assistant',
        content: '',
        createdAt: 2,
        architectureRun: {
          runId: 'run-1',
          schemaId: 'strategic-decision-council',
          status: 'running',
          hostProjectionKind: 'workflow-envelope',
          trace: [],
          routeHops: [],
        },
      }),
    ];

    expect(shouldReplaceTurnsFromHydratedHistory({
      sessionId: 'session-1',
      hydratedMessages,
      currentTurns: [makeTurn({ id: 'turn-live', items: [] })],
      activeTurnId: 'turn-live',
    })).toBe(true);
  });

  it('keeps an empty live placeholder when hydrated history still has no assistant turn at all', () => {
    const hydratedMessages = [
      makeMessage({ id: 'user-1', role: 'user', content: 'Need more tool calls.', createdAt: 1 }),
    ];

    expect(shouldReplaceTurnsFromHydratedHistory({
      sessionId: 'session-1',
      hydratedMessages,
      currentTurns: [makeTurn({ id: 'turn-live', items: [] })],
      activeTurnId: 'turn-live',
    })).toBe(false);
  });

  it('keeps a reconnecting live turn when the loop is still active but the local turn has not re-materialized yet', () => {
    expect(shouldReplaceTurnsFromHydratedHistory({
      sessionId: 'session-1',
      hydratedMessages: [],
      currentTurns: [],
      activeTurnId: 'turn-live',
      hasActiveLoop: true,
    })).toBe(false);
  });
});
