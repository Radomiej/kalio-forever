import { beforeEach, describe, expect, it } from 'vitest';
import type { ChatMessage, ChatSession } from '@kalio/types';
import { useSessionStore } from '../../store/sessionStore';
import { hydrateSessionHistoryIntoStore } from './historyHydration';

function makeSession(id: string, title: string): ChatSession {
  return {
    id,
    personaId: 'default',
    title,
    createdAt: 1,
    updatedAt: 1,
  };
}

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

function resetSessionStore(sessions: ChatSession[], activeSessionId: string | null): void {
  useSessionStore.setState({
    sessions,
    activeSessionId,
    messages: [],
    sessionMessages: {},
    hydratedSessionIds: {},
    streamingChunks: {},
    thinkingChunks: {},
    chunkSessionIds: {},
    pendingMessage: null,
    pendingRAAppLaunchIntent: null,
    pendingUserActions: [],
    agentTurns: [],
    sessionAgentTurns: {},
    activeTurnId: null,
    sessionActiveTurnIds: {},
  });
}

describe('hydrateSessionHistoryIntoStore', () => {
  const primarySession = makeSession('session-1', 'Primary');
  const otherSession = makeSession('session-2', 'Other');
  const fetchedMessages = [
    makeMessage({
      id: 'user-1',
      role: 'user',
      content: 'Inspect the repository',
      createdAt: 1,
    }),
    makeMessage({
      id: 'assistant-1',
      role: 'assistant',
      content: 'Spawning a CLI child session.',
      createdAt: 2,
    }),
  ] satisfies ChatMessage[];

  beforeEach(() => {
    resetSessionStore([primarySession, otherSession], primarySession.id);
  });

  it('refreshes the active projection from stored session state after hydration', async () => {
    const realSetMessages = useSessionStore.getState().setMessages;
    const realSetAgentTurns = useSessionStore.getState().setAgentTurns;

    await hydrateSessionHistoryIntoStore({
      sessionId: primarySession.id,
      getActiveSessionId: () => primarySession.id,
      getSessions: () => useSessionStore.getState().sessions,
      getSessionMessages: (sessionId) => useSessionStore.getState().getSessionMessages(sessionId),
      setMessages: (messages, sessionId) => {
        useSessionStore.setState({
          activeSessionId: otherSession.id,
          messages: [],
          agentTurns: [],
          activeTurnId: null,
        });
        realSetMessages(messages, sessionId);
      },
      setAgentTurns: (turns, sessionId) => {
        realSetAgentTurns(turns, sessionId);
        useSessionStore.setState({ activeSessionId: primarySession.id });
      },
      getSessionAgentTurns: (sessionId) => useSessionStore.getState().getSessionAgentTurns(sessionId),
      getSessionActiveTurnId: (sessionId) => useSessionStore.getState().getSessionActiveTurnId(sessionId),
      hasActiveLoopForSession: () => false,
      fetchMessages: async () => fetchedMessages,
    });

    const state = useSessionStore.getState();
    expect(state.hydratedSessionIds[primarySession.id]).toBe(true);
    expect(state.sessionMessages[primarySession.id]).toEqual(fetchedMessages);
    expect(state.messages).toEqual(fetchedMessages);
    expect(state.sessionAgentTurns[primarySession.id]).toHaveLength(1);
    expect(state.agentTurns).toEqual(state.sessionAgentTurns[primarySession.id]);
  });

  it('does not overwrite a different active session while hydrating background history', async () => {
    const otherMessages = [
      makeMessage({
        id: 'other-user-1',
        sessionId: otherSession.id,
        role: 'user',
        content: 'Existing active chat',
        createdAt: 1,
      }),
    ];

    useSessionStore.setState({
      activeSessionId: otherSession.id,
      messages: otherMessages,
      sessionMessages: {
        [otherSession.id]: otherMessages,
      },
    });

    await hydrateSessionHistoryIntoStore({
      sessionId: primarySession.id,
      getActiveSessionId: () => primarySession.id,
      getSessions: () => useSessionStore.getState().sessions,
      getSessionMessages: (sessionId) => useSessionStore.getState().getSessionMessages(sessionId),
      setMessages: useSessionStore.getState().setMessages,
      setAgentTurns: useSessionStore.getState().setAgentTurns,
      getSessionAgentTurns: (sessionId) => useSessionStore.getState().getSessionAgentTurns(sessionId),
      getSessionActiveTurnId: (sessionId) => useSessionStore.getState().getSessionActiveTurnId(sessionId),
      hasActiveLoopForSession: () => false,
      fetchMessages: async () => fetchedMessages,
    });

    const state = useSessionStore.getState();
    expect(state.activeSessionId).toBe(otherSession.id);
    expect(state.messages).toEqual(otherMessages);
    expect(state.sessionMessages[primarySession.id]).toEqual(fetchedMessages);
  });
});
