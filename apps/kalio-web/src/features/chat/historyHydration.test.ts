import { beforeEach, describe, expect, it } from 'vitest';
import type { ChatMessage, ChatRunSnapshot, ChatSession } from '@kalio/types';
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

  it.each(['failed', 'interrupted'] as const)('restores a user-only %s turn from the journal without fabricating an assistant message', async status => {
    const prompt = makeMessage({ id: 'early-prompt', role: 'user', turnId: 'early-turn', content: 'Hello' });
    const run: ChatRunSnapshot = { id: 'early-run', sessionId: primarySession.id, turnId: 'early-turn',
      phase: status, status, runtimeKind: 'chat', retryCount: 0, safeResume: false,
      startedAt: 1, updatedAt: 2, lastHeartbeatAt: 2, errorCode: 'LLM_ERROR', errorMessage: 'Host unavailable' };
    let requested: string[] = [];
    await hydrateSessionHistoryIntoStore({
      sessionId: primarySession.id, getSessionMessages: useSessionStore.getState().getSessionMessages,
      setMessages: useSessionStore.getState().setMessages, setAgentTurns: useSessionStore.getState().setAgentTurns,
      getSessionAgentTurns: useSessionStore.getState().getSessionAgentTurns,
      getSessionActiveTurnId: useSessionStore.getState().getSessionActiveTurnId,
      hasActiveLoopForSession: () => false, fetchMessages: async () => [prompt],
      fetchRunOutcomes: async (_id, turnIds) => { requested = turnIds; return [run]; },
    });
    expect(requested).toEqual(['early-turn']);
    expect(useSessionStore.getState().getSessionMessages(primarySession.id)).toEqual([prompt]);
    expect(useSessionStore.getState().getSessionAgentTurns(primarySession.id)).toEqual([{
      id: 'early-turn', sessionId: primarySession.id, promptMessageId: prompt.id, items: [], done: true,
      error: { code: 'LLM_ERROR', message: 'Host unavailable' },
    }]);
  });

  it('keeps post-approval tool entries in the completed active transcript without reloading the page', async () => {
    const calls = [
      { id: 'read', name: 'fs_read', args: { path: 'package.json' } },
      { id: 'build', name: 'terminal_spawn', args: { command: 'npm' } },
      { id: 'output', name: 'terminal_output', args: { id: 'terminal-1' } },
    ];
    const prompt = makeMessage({ id: 'u1', role: 'user', content: 'Build', createdAt: 1 });
    const localAssistant = makeMessage({ id: 'a1', turnId: 'turn-1', promptMessageId: 'u1',
      content: 'Build exited 0', toolCalls: calls.slice(0, 1), createdAt: 2 });
    useSessionStore.getState().setMessages([prompt, localAssistant], primarySession.id);
    useSessionStore.getState().startAgentTurn('turn-1', primarySession.id, undefined, prompt.id);
    for (const call of calls) {
      useSessionStore.getState().addTurnItem({ kind: 'tool', callId: call.id }, primarySession.id);
    }
    useSessionStore.getState().finalizeAgentTurn(primarySession.id, 'turn-1');
    const durable = [prompt, { ...localAssistant, toolCalls: calls }, ...calls.map((call, index) =>
      makeMessage({ id: `r-${call.id}`, role: 'tool_result', toolCallId: call.id,
        turnId: 'turn-1', promptMessageId: prompt.id, content: '{"status":"exited","exitCode":0}',
        createdAt: 3 + index }))];

    await hydrateSessionHistoryIntoStore({
      sessionId: primarySession.id,
      getActiveSessionId: () => primarySession.id,
      getSessions: () => useSessionStore.getState().sessions,
      getSessionMessages: useSessionStore.getState().getSessionMessages,
      setMessages: useSessionStore.getState().setMessages,
      setAgentTurns: useSessionStore.getState().setAgentTurns,
      getSessionAgentTurns: useSessionStore.getState().getSessionAgentTurns,
      getSessionActiveTurnId: useSessionStore.getState().getSessionActiveTurnId,
      hasActiveLoopForSession: () => false,
      fetchMessages: async () => durable,
      fetchRunOutcomes: async () => [],
    });

    const state = useSessionStore.getState();
    expect(state.activeTurnId).toBeNull();
    expect(state.agentTurns[0]).toMatchObject({ done: true, promptMessageId: prompt.id });
    expect(state.agentTurns[0].items.filter((item) => item.kind === 'tool'))
      .toEqual(calls.map((call) => ({ kind: 'tool', callId: call.id })));
    expect(state.messages.find((message) => message.id === localAssistant.id)?.toolCalls).toEqual(calls);
    expect(state.messages.filter((message) => message.role === 'tool_result')).toHaveLength(3);
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
      fetchRunOutcomes: async () => [],
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
      fetchRunOutcomes: async () => [],
    });

    const state = useSessionStore.getState();
    expect(state.activeSessionId).toBe(otherSession.id);
    expect(state.messages).toEqual(otherMessages);
    expect(state.sessionMessages[primarySession.id]).toEqual(fetchedMessages);
  });
});
