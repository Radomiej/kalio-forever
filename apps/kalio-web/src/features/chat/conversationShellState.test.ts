import { describe, expect, it } from 'vitest';
import type { ChatSession } from '@kalio/types';
import { resolveConversationShellState } from './conversationShellState';
import type { LiveTurnState } from './liveTurnState';

function session(overrides: Partial<ChatSession> = {}): ChatSession {
  return {
    id: 'session-1',
    title: 'New Chat',
    personaId: 'default',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function liveTurnState(overrides: Partial<LiveTurnState> = {}): LiveTurnState {
  return {
    sessionId: 'session-1',
    phase: 'idle',
    stoppable: false,
    previewText: null,
    toolName: null,
    queuedDepth: 0,
    showPlaceholderBubble: false,
    workflowActive: false,
    ...overrides,
  };
}

describe('resolveConversationShellState', () => {
  it('returns launch-form for an empty host session', () => {
    expect(resolveConversationShellState({
      activeSession: session(),
      activeSessionId: 'session-1',
      conversationTimelineLength: 0,
      liveTurnState: liveTurnState(),
    })).toEqual({ mode: 'launch-form' });
  });

  it('returns live-turn for an empty host session with an active optimistic turn', () => {
    expect(resolveConversationShellState({
      activeSession: session(),
      activeSessionId: 'session-1',
      conversationTimelineLength: 0,
      liveTurnState: liveTurnState({ phase: 'pending', stoppable: true, showPlaceholderBubble: true }),
    })).toEqual({ mode: 'live-turn' });
  });

  it('returns timeline when the session already has renderable conversation items', () => {
    expect(resolveConversationShellState({
      activeSession: session(),
      activeSessionId: 'session-1',
      conversationTimelineLength: 2,
      liveTurnState: liveTurnState({ phase: 'pending', stoppable: true }),
    })).toEqual({ mode: 'timeline' });
  });

  it('returns pending-child-session for an empty child session', () => {
    expect(resolveConversationShellState({
      activeSession: session({ id: 'branch-1', parentSessionId: 'host-1' }),
      activeSessionId: 'branch-1',
      conversationTimelineLength: 0,
      liveTurnState: liveTurnState(),
    })).toEqual({ mode: 'pending-child-session' });
  });
});
