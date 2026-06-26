import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '@kalio/types';
import type { SessionProjectionState } from './sessionStore.helpers';
import { resolveSessionSlice } from './sessionStore.helpers';

function makeMessage(overrides: Partial<ChatMessage>): ChatMessage {
  return {
    id: 'message-1',
    sessionId: 'session-1',
    role: 'assistant',
    content: 'Answer',
    createdAt: 1,
    ...overrides,
  };
}

describe('resolveSessionSlice', () => {
  it('tolerates partial projection state maps without throwing', () => {
    const partialState = {
      activeSessionId: 'session-1',
      messages: [makeMessage({ id: 'assistant-1', sessionId: 'session-1' })],
      agentTurns: [],
      activeTurnId: null,
    } as unknown as SessionProjectionState;

    expect(resolveSessionSlice(partialState, 'session-1')).toEqual({
      messages: partialState.messages,
      agentTurns: [],
      activeTurnId: null,
    });
  });

  it('rebuilds a restoring turn from pending chunks when persisted turns are absent', () => {
    const state: SessionProjectionState = {
      activeSessionId: 'session-1',
      messages: [
        makeMessage({
          id: 'user-1',
          sessionId: 'session-1',
          role: 'user',
          content: 'Continue the workflow',
          createdAt: 1,
        }),
      ],
      sessionMessages: {},
      streamingChunks: {
        'assistant-pending': 'Streaming reply',
      },
      thinkingChunks: {
        'assistant-pending': 'Thinking...',
      },
      chunkSessionIds: {
        'assistant-pending': 'session-1',
      },
      agentTurns: [],
      sessionAgentTurns: {},
      activeTurnId: null,
      sessionActiveTurnIds: {},
    };

    const slice = resolveSessionSlice(state, 'session-1');

    expect(slice.messages).toEqual([
      state.messages[0],
      expect.objectContaining({
        id: 'assistant-pending',
        sessionId: 'session-1',
        content: 'Streaming reply',
        thinking: 'Thinking...',
        streaming: true,
      }),
    ]);
    expect(slice.agentTurns).toEqual([
      {
        id: 'restoring-session-1',
        sessionId: 'session-1',
        promptMessageId: 'user-1',
        items: [{ kind: 'text', messageId: 'assistant-pending' }],
        done: false,
      },
    ]);
    expect(slice.activeTurnId).toBe('restoring-session-1');
  });
});
