import { describe, it, expect, beforeEach } from 'vitest';
import { useAgentStore } from './agentStore';
import { useSessionStore } from './sessionStore';

function resetStore() {
  useSessionStore.setState({
    agentTurns: [],
    sessionAgentTurns: {},
    activeTurnId: null,
    sessionActiveTurnIds: {},
    activeSessionId: null,
    messages: [],
    sessionMessages: {},
    streamingChunks: {},
    thinkingChunks: {},
    chunkSessionIds: {},
  });
  useAgentStore.setState({
    isStreaming: false,
    streamingMessageId: undefined,
  });
}

describe('sessionStore — AgentTurn actions', () => {
  beforeEach(resetStore);

  describe('startAgentTurn', () => {
    it('appends a new turn and sets activeTurnId', () => {
      useSessionStore.getState().startAgentTurn('t1', 's1');
      const agentTurns = useSessionStore.getState().getSessionAgentTurns('s1');
      const activeTurnId = useSessionStore.getState().getSessionActiveTurnId('s1');
      expect(agentTurns).toHaveLength(1);
      expect(agentTurns[0]).toMatchObject({ id: 't1', sessionId: 's1', items: [], done: false });
      expect(activeTurnId).toBe('t1');
    });
  });

  describe('finalizeAgentTurn', () => {
    it('marks the active turn as done and clears activeTurnId', () => {
      useSessionStore.getState().startAgentTurn('t1', 's1');
      useSessionStore.getState().finalizeAgentTurn('s1');
      const agentTurns = useSessionStore.getState().getSessionAgentTurns('s1');
      const activeTurnId = useSessionStore.getState().getSessionActiveTurnId('s1');
      expect(agentTurns[0].done).toBe(true);
      expect(activeTurnId).toBeNull();
    });
  });

  describe('markAgentTurnError', () => {
    it('sets error on the matching turn without changing other turns', () => {
      useSessionStore.getState().startAgentTurn('t1', 's1');
      useSessionStore.getState().finalizeAgentTurn('s1');
      useSessionStore.getState().startAgentTurn('t2', 's1');

      useSessionStore.getState().markAgentTurnError('t1', { code: 'INTERRUPTED', message: 'Interrupted' }, 's1');

      const agentTurns = useSessionStore.getState().getSessionAgentTurns('s1');
      expect(agentTurns[0].error).toEqual({ code: 'INTERRUPTED', message: 'Interrupted' });
      expect(agentTurns[1].error).toBeUndefined();
    });

    it('is a no-op for an unknown turnId', () => {
      useSessionStore.getState().startAgentTurn('t1', 's1');
      useSessionStore.getState().markAgentTurnError('unknown', { code: 'LLM_ERROR', message: 'fail' }, 's1');

      const agentTurns = useSessionStore.getState().getSessionAgentTurns('s1');
      expect(agentTurns[0].error).toBeUndefined();
    });

    it('does not change activeTurnId', () => {
      useSessionStore.getState().startAgentTurn('t1', 's1');
      useSessionStore.getState().markAgentTurnError('t1', { code: 'MAX_ITERATIONS_REACHED', message: 'too many' }, 's1');

      expect(useSessionStore.getState().getSessionActiveTurnId('s1')).toBe('t1');
    });
  });

  describe('removeLastAgentTurn', () => {
    it('removes the last turn from agentTurns', () => {
      useSessionStore.setState({ activeSessionId: 's1' });
      useSessionStore.getState().startAgentTurn('t1', 's1');
      useSessionStore.getState().finalizeAgentTurn('s1');
      useSessionStore.getState().startAgentTurn('t2', 's1');

      useSessionStore.getState().removeLastAgentTurn();

      const agentTurns = useSessionStore.getState().getSessionAgentTurns('s1');
      expect(agentTurns).toHaveLength(1);
      expect(agentTurns[0].id).toBe('t1');
    });

    it('clears activeTurnId', () => {
      useSessionStore.setState({ activeSessionId: 's1' });
      useSessionStore.getState().startAgentTurn('t1', 's1');
      useSessionStore.getState().removeLastAgentTurn();

      expect(useSessionStore.getState().getSessionActiveTurnId('s1')).toBeNull();
    });

    it('is a no-op when agentTurns is empty (does not throw)', () => {
      useSessionStore.setState({ activeSessionId: 's1' });
      expect(() => useSessionStore.getState().removeLastAgentTurn()).not.toThrow();
      expect(useSessionStore.getState().getSessionAgentTurns('s1')).toHaveLength(0);
    });

    it('only removes the last turn for the active session, leaves other-session turns intact', () => {
      // s1 has two turns, s2 has one turn
      useSessionStore.setState({
        activeSessionId: 's1',
        sessionAgentTurns: {
          s1: [
            { id: 'a1', sessionId: 's1', items: [], done: true },
            { id: 'a2', sessionId: 's1', items: [], done: false },
          ],
          s2: [
            { id: 'b1', sessionId: 's2', items: [], done: true },
          ],
        },
        sessionActiveTurnIds: { s1: 'a2', s2: null },
        agentTurns: [
          { id: 'a1', sessionId: 's1', items: [], done: true },
          { id: 'b1', sessionId: 's2', items: [], done: true },
          { id: 'a2', sessionId: 's1', items: [], done: false },
        ],
        activeTurnId: 'a2',
      });

      useSessionStore.getState().removeLastAgentTurn();

      const agentTurns = useSessionStore.getState().getSessionAgentTurns('s1');
      const activeTurnId = useSessionStore.getState().getSessionActiveTurnId('s1');
      expect(agentTurns.map((t) => t.id)).toEqual(['a1']);
      expect(useSessionStore.getState().getSessionAgentTurns('s2').map((t) => t.id)).toEqual(['b1']);
      expect(activeTurnId).toBeNull();
    });

    it('does not touch turns from another session when active session has no turns', () => {
      useSessionStore.setState({
        activeSessionId: 's2',
        sessionAgentTurns: {
          s1: [
            { id: 'a1', sessionId: 's1', items: [], done: true },
          ],
          s2: [],
        },
        sessionActiveTurnIds: { s1: null, s2: null },
        agentTurns: [
          { id: 'a1', sessionId: 's1', items: [], done: true },
        ],
        activeTurnId: null,
      });

      useSessionStore.getState().removeLastAgentTurn();

      expect(useSessionStore.getState().getSessionAgentTurns('s1')).toHaveLength(1);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// REGRESSION: switching sessions must clear in-flight agent turns so stale
// streaming content from the old session does not bleed into the new session.
// Bug: setActiveSession only cleared messages and pendingUserActions but left
// agentTurns and activeTurnId intact, causing ghost turns to appear.
// ─────────────────────────────────────────────────────────────────────────────
describe('REGRESSION: setActiveSession clears in-flight agent state', () => {
  beforeEach(resetStore);

  it('clears agentTurns on session switch', () => {
    useSessionStore.setState({ activeSessionId: 'session-A' });
    useSessionStore.getState().startAgentTurn('t1', 'session-A');
    expect(useSessionStore.getState().agentTurns).toHaveLength(1);

    useSessionStore.getState().setActiveSession('session-B');

    expect(useSessionStore.getState().agentTurns).toHaveLength(0);
  });

  it('clears activeTurnId on session switch', () => {
    useSessionStore.setState({ activeSessionId: 'session-A' });
    useSessionStore.getState().startAgentTurn('t1', 'session-A');
    expect(useSessionStore.getState().activeTurnId).toBe('t1');

    useSessionStore.getState().setActiveSession('session-B');

    expect(useSessionStore.getState().activeTurnId).toBeNull();
  });

  it('clears messages on session switch', () => {
    useSessionStore.setState({
      activeSessionId: 'session-A',
      messages: [{ id: 'm1', sessionId: 'session-A', role: 'user', content: 'hello', createdAt: 0 }],
    });

    useSessionStore.getState().setActiveSession('session-B');

    expect(useSessionStore.getState().messages).toHaveLength(0);
  });

  it('clears agent streaming state on session switch', () => {
    useSessionStore.setState({ activeSessionId: 'session-A' });
    useAgentStore.setState({
      isStreaming: true,
      streamingMessageId: 'msg-streaming',
    });

    useSessionStore.getState().setActiveSession('session-B');

    expect(useAgentStore.getState().isStreaming).toBe(false);
    expect(useAgentStore.getState().streamingMessageId).toBeUndefined();
  });
});

describe('REGRESSION: session projections keep pending assistant state', () => {
  beforeEach(resetStore);

  it('merges pending streaming chunks when setMessages updates a session slice', () => {
    const persistedMessage = {
      id: 'm-stream',
      sessionId: 'session-A',
      role: 'assistant' as const,
      content: 'persisted answer',
      createdAt: 1,
    };

    useSessionStore.setState({
      activeSessionId: 'session-A',
      messages: [persistedMessage],
      sessionMessages: {
        'session-A': [persistedMessage],
      },
      streamingChunks: {
        'm-stream': 'live answer',
      },
      thinkingChunks: {
        'm-stream': 'live thinking',
      },
      chunkSessionIds: {
        'm-stream': 'session-A',
      },
    });

    useSessionStore.getState().setMessages([persistedMessage], 'session-A');

    expect(useSessionStore.getState().getSessionMessages('session-A')).toMatchObject([
      {
        id: 'm-stream',
        content: 'live answer',
        thinking: 'live thinking',
        streaming: true,
      },
    ]);
    expect(useSessionStore.getState().messages).toMatchObject([
      {
        id: 'm-stream',
        content: 'live answer',
        thinking: 'live thinking',
        streaming: true,
      },
    ]);
  });

  it('rebuilds an active turn from pending chunks when switching back to that session', () => {
    useSessionStore.setState({
      activeSessionId: 'session-A',
      chunkSessionIds: {
        'm-pending': 'session-B',
      },
      streamingChunks: {
        'm-pending': 'partial answer',
      },
      sessionMessages: {
        'session-B': [],
      },
    });

    useSessionStore.getState().setActiveSession('session-B');

    expect(useSessionStore.getState().messages).toMatchObject([
      {
        id: 'm-pending',
        sessionId: 'session-B',
        content: 'partial answer',
        streaming: true,
      },
    ]);
    expect(useSessionStore.getState().agentTurns).toEqual([
      {
        id: 'restoring-session-B',
        sessionId: 'session-B',
        items: [{ kind: 'text', messageId: 'm-pending' }],
        done: false,
      },
    ]);
    expect(useSessionStore.getState().activeTurnId).toBe('restoring-session-B');
  });
});
