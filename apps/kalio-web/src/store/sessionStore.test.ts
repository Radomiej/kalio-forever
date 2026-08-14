import { describe, it, expect, beforeEach } from 'vitest';
import { useAgentStore } from './agentStore';
import { useSessionStore } from './sessionStore';

function resetStore() {
  useSessionStore.setState({
    sessions: [],
    agentTurns: [],
    sessionAgentTurns: {},
    activeTurnId: null,
    sessionActiveTurnIds: {},
    activeSessionId: null,
    messages: [],
    sessionMessages: {},
    sessionHistoryMeta: {},
    hydratedSessionIds: {},
    pendingMessage: null,
    pendingRAAppLaunchIntent: null,
    pendingUserActions: [],
    streamingChunks: {},
    thinkingChunks: {},
    chunkSessionIds: {},
  });
  useAgentStore.setState({
    isStreaming: false,
    streamingMessageId: undefined,
    streamingSessionId: null,
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

    it('reuses an existing turnId instead of appending a duplicate turn', () => {
      useSessionStore.getState().startAgentTurn('t1', 's1');
      useSessionStore.getState().startAgentTurn('t1', 's1');

      const agentTurns = useSessionStore.getState().getSessionAgentTurns('s1');
      const activeTurnId = useSessionStore.getState().getSessionActiveTurnId('s1');

      expect(agentTurns).toHaveLength(1);
      expect(agentTurns[0]).toMatchObject({ id: 't1', sessionId: 's1', done: false });
      expect(activeTurnId).toBe('t1');
    });

    it('uses explicit promptMessageId from agent:start instead of inferring from the latest user message', () => {
      useSessionStore.setState({
        activeSessionId: 's1',
        sessionMessages: {
          s1: [
            { id: 'user-old', sessionId: 's1', role: 'user', content: 'old', createdAt: 1 },
            { id: 'user-new', sessionId: 's1', role: 'user', content: 'new', createdAt: 2 },
          ],
        },
      });

      useSessionStore.getState().startAgentTurn('t1', 's1', undefined, 'user-old');

      const agentTurns = useSessionStore.getState().getSessionAgentTurns('s1');
      expect(agentTurns[0]).toMatchObject({ id: 't1', promptMessageId: 'user-old' });
    });
  });

  describe('appendChunk', () => {
    it('links live assistant placeholders to the active turn and prompt', () => {
      useSessionStore.setState({
        activeSessionId: 's1',
        sessionMessages: {
          s1: [
            { id: 'user-1', sessionId: 's1', role: 'user', content: 'Reply FIRST', createdAt: 1 },
          ],
        },
      });
      useSessionStore.getState().startAgentTurn('turn-1', 's1', undefined, 'user-1');

      useSessionStore.getState().appendChunk('assistant-1', 'FIRST', false, 's1');

      const messages = useSessionStore.getState().getSessionMessages('s1');
      expect(messages.find((message) => message.id === 'assistant-1')).toMatchObject({
        turnId: 'turn-1',
        promptMessageId: 'user-1',
      });
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

    it('does not finalize a newer turn for a delayed terminal event', () => {
      useSessionStore.getState().startAgentTurn('turn-a', 's1');
      useSessionStore.getState().finalizeAgentTurn('s1');
      useSessionStore.getState().startAgentTurn('turn-b', 's1');

      useSessionStore.getState().finalizeAgentTurn('s1', 'turn-a');

      expect(useSessionStore.getState().getSessionActiveTurnId('s1')).toBe('turn-b');
      expect(useSessionStore.getState().getSessionAgentTurns('s1')).toMatchObject([
        { id: 'turn-a', done: true },
        { id: 'turn-b', done: false },
      ]);
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
      streamingSessionId: 'session-A',
    });

    useSessionStore.getState().setActiveSession('session-B');

    expect(useAgentStore.getState().isStreaming).toBe(false);
    expect(useAgentStore.getState().streamingMessageId).toBeUndefined();
    expect(useAgentStore.getState().streamingSessionId).toBeNull();
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

describe('REGRESSION: session lifecycle updates can arrive before session creation', () => {
  beforeEach(resetStore);

  it('upserts a missing session when lifecycle recovery applies an update first', () => {
    useSessionStore.getState().updateSession('arch-branch-1', {
      id: 'arch-branch-1',
      personaId: 'default',
      title: 'Architecture: Analyst',
      parentSessionId: 'arch-root',
      kind: 'subagent',
      createdAt: 10,
      updatedAt: 11,
    });

    expect(useSessionStore.getState().sessions).toContainEqual(expect.objectContaining({
      id: 'arch-branch-1',
      title: 'Architecture: Analyst',
      parentSessionId: 'arch-root',
      kind: 'subagent',
    }));
  });
});

describe('sessionStore lifecycle, streaming, and queue actions', () => {
  beforeEach(resetStore);

  it('adds sessions and merges repeated additions by id', () => {
    const first = { id: 's1', personaId: 'default', title: 'First', createdAt: 1, updatedAt: 1 };
    useSessionStore.getState().addSession(first);
    useSessionStore.getState().addSession({ ...first, title: 'Updated', updatedAt: 2 });

    expect(useSessionStore.getState().sessions).toEqual([{ ...first, title: 'Updated', updatedAt: 2 }]);
  });

  it('creates a session and exposes null-safe history and hydration helpers', () => {
    const id = useSessionStore.getState().createSession('Created');

    expect(id).toEqual(expect.any(String));
    expect(useSessionStore.getState().sessions[0]).toMatchObject({ id, title: 'Created' });
    expect(useSessionStore.getState().getSessionHistoryMeta(null)).toBeNull();
    expect(useSessionStore.getState().isSessionHydrated(null)).toBe(false);

    useSessionStore.getState().markSessionHydrated(id);
    useSessionStore.getState().markSessionHydrated(id);
    expect(useSessionStore.getState().isSessionHydrated(id)).toBe(true);
  });

  it('sets and removes session history metadata without mutating a missing entry', () => {
    const meta = { totalCount: 10, hasMoreBefore: true, oldestLoadedMessageId: 'oldest-1' };

    useSessionStore.getState().setSessionHistoryMeta(null, meta);
    useSessionStore.getState().setSessionHistoryMeta('s1', meta);
    expect(useSessionStore.getState().getSessionHistoryMeta('s1')).toEqual(meta);
    useSessionStore.getState().setSessionHistoryMeta('s1', null);
    expect(useSessionStore.getState().getSessionHistoryMeta('s1')).toBeNull();
    useSessionStore.getState().setSessionHistoryMeta('s1', null);
    expect(useSessionStore.getState().sessionHistoryMeta).toEqual({});
  });

  it('keeps global messages when setMessages has no active target', () => {
    const message = { id: 'm1', sessionId: 's1', role: 'user' as const, content: 'hello', createdAt: 1 };

    useSessionStore.getState().setMessages([message]);

    expect(useSessionStore.getState().messages).toEqual([message]);
    expect(useSessionStore.getState().sessionMessages).toEqual({});
  });

  it('isolates streaming chunks and flushes thinking before text', () => {
    useSessionStore.setState({ activeSessionId: 's1' });
    useSessionStore.getState().appendChunk('m1', 'thinking', true, 's1');
    useSessionStore.getState().appendChunk('m1', 'answer', false, 's1');

    const message = useSessionStore.getState().getSessionMessages('s1')[0];
    expect(message).toMatchObject({ content: 'answer', thinking: 'thinking', streaming: true });
    expect(useSessionStore.getState().thinkingChunks).toEqual({});
    expect(useSessionStore.getState().streamingChunks).toEqual({ m1: 'answer' });

    useSessionStore.getState().finalizeChunk('m1');
    expect(useSessionStore.getState().getSessionMessages('s1')[0]).toMatchObject({
      content: 'answer',
      thinking: 'thinking',
      streaming: false,
    });
    expect(useSessionStore.getState().streamingChunks).toEqual({});
    expect(useSessionStore.getState().chunkSessionIds).toEqual({});
  });

  it('handles existing messages, missing targets, and pending chunk cleanup', () => {
    const message = { id: 'm1', sessionId: 's1', role: 'assistant' as const, content: 'old', createdAt: 1 };
    useSessionStore.setState({ activeSessionId: 's1', sessionMessages: { s1: [message] } });

    useSessionStore.getState().appendChunk('m1', 'new', false, 's1');
    expect(useSessionStore.getState().getSessionMessages('s1')[0]).toMatchObject({ content: 'new', streaming: true });
    useSessionStore.getState().clearPendingChunks('s1');
    expect(useSessionStore.getState().streamingChunks).toEqual({});
    useSessionStore.getState().appendChunk('m2', 'discard', false, 's1');
    useSessionStore.getState().clearPendingChunks('s1');
    expect(useSessionStore.getState().streamingChunks).toEqual({});

    useSessionStore.setState({ activeSessionId: null });
    useSessionStore.getState().appendChunk('missing', 'ignored');
    expect(useSessionStore.getState().chunkSessionIds).toEqual({});
  });

  it('flushes thinking and text chunks when a tool starts', () => {
    const message = { id: 'm1', sessionId: 's1', role: 'assistant' as const, content: '', createdAt: 1, streaming: true };
    useSessionStore.setState({
      activeSessionId: 's1',
      sessionMessages: { s1: [message] },
      messages: [message],
      thinkingChunks: { m1: 'thought' },
      streamingChunks: { m1: 'partial' },
      chunkSessionIds: { m1: 's1' },
    });

    useSessionStore.getState().flushThinkingChunks('s1');
    expect(useSessionStore.getState().getSessionMessages('s1')[0]).toMatchObject({ thinking: 'thought' });
    useSessionStore.getState().flushStreamingChunks('s1');
    expect(useSessionStore.getState().sessionMessages.s1[0]).toMatchObject({ content: 'partial', streaming: false });
    expect(useSessionStore.getState().streamingChunks).toEqual({});
    useSessionStore.getState().flushThinkingChunks(null);
    useSessionStore.getState().flushStreamingChunks(null);
  });

  it('supports pending message and FIFO user actions', () => {
    useSessionStore.getState().setPendingMessage('draft');
    useSessionStore.getState().enqueueUserAction('first');
    useSessionStore.getState().enqueueUserAction('second');

    expect(useSessionStore.getState().pendingMessage).toBe('draft');
    expect(useSessionStore.getState().dequeueUserAction()).toBe('first');
    expect(useSessionStore.getState().dequeueUserAction()).toBe('second');
    expect(useSessionStore.getState().dequeueUserAction()).toBeUndefined();
    useSessionStore.getState().setPendingMessage(null);
    expect(useSessionStore.getState().pendingMessage).toBeNull();
  });

  it('removes active and inactive session projections', () => {
    useSessionStore.setState({
      activeSessionId: 's1',
      sessions: [
        { id: 's1', personaId: 'default', title: 'One', createdAt: 1, updatedAt: 1 },
        { id: 's2', personaId: 'default', title: 'Two', createdAt: 1, updatedAt: 1 },
      ],
      messages: [{ id: 'm1', sessionId: 's1', role: 'user', content: 'one', createdAt: 1 }],
      sessionMessages: { s1: [], s2: [] },
      sessionHistoryMeta: { s1: { totalCount: 1, hasMoreBefore: false, oldestLoadedMessageId: 'm1' } },
      hydratedSessionIds: { s1: true },
      sessionAgentTurns: { s1: [], s2: [] },
      sessionActiveTurnIds: { s1: null, s2: null },
      agentTurns: [],
    });

    useSessionStore.getState().removeSession('s2');
    expect(useSessionStore.getState().sessions).toHaveLength(1);
    useSessionStore.getState().removeSession('s1');
    expect(useSessionStore.getState()).toMatchObject({ activeSessionId: null, messages: [], agentTurns: [], activeTurnId: null });
  });

  it('keeps turn actions isolated and handles no active turn targets', () => {
    useSessionStore.getState().addTurnItem({ kind: 'text', messageId: 'm1' });
    useSessionStore.getState().clearAgentTurns();
    useSessionStore.getState().setAgentTurns([], null);
    useSessionStore.getState().updateAgentTurn('missing', { done: true });
    useSessionStore.getState().markAgentTurnError('missing', { code: 'ERR', message: 'missing' });
    expect(useSessionStore.getState().agentTurns).toEqual([]);

    useSessionStore.setState({ activeSessionId: 's1' });
    useSessionStore.getState().startAgentTurn('t1', 's1');
    useSessionStore.getState().addTurnItem({ kind: 'text', messageId: 'm1' }, 's1');
    useSessionStore.getState().updateAgentTurn('t1', { done: true }, 's1');
    expect(useSessionStore.getState().getSessionAgentTurns('s1')[0]).toMatchObject({ done: true, items: [{ kind: 'text', messageId: 'm1' }] });
  });

  it('covers session projection no-ops and inactive-session updates', () => {
    const activeMessage = { id: 'active-message', sessionId: 's1', role: 'user' as const, content: 'active', createdAt: 1 };
    const backgroundMessage = { id: 'background-message', sessionId: 's2', role: 'assistant' as const, content: 'background', createdAt: 2 };
    useSessionStore.getState().setSessions([{ id: 's1', personaId: 'default', title: 'One', createdAt: 1, updatedAt: 1 }]);
    useSessionStore.setState({ activeSessionId: 's1' });
    useSessionStore.getState().addMessage(activeMessage);
    useSessionStore.getState().addMessage(backgroundMessage);
    expect(useSessionStore.getState().messages).toEqual([activeMessage]);
    expect(useSessionStore.getState().getSessionMessages('s2')).toEqual([backgroundMessage]);

    useSessionStore.getState().setActiveSession('s1');
    useSessionStore.getState().updateSession('s1', { title: 'Renamed' });
    useSessionStore.getState().updateSession('missing', { title: 'Not enough data' });
    expect(useSessionStore.getState().sessions).toEqual([{ id: 's1', personaId: 'default', title: 'Renamed', createdAt: 1, updatedAt: 1 }]);

    useSessionStore.getState().appendChunk('background-chunk', 'background', false, 's2');
    expect(useSessionStore.getState().messages).toEqual([activeMessage]);
    useSessionStore.getState().finalizeChunk('unknown-message');
    useSessionStore.getState().clearPendingChunks('s2');
    useSessionStore.getState().clearPendingChunks('s2');
    useSessionStore.getState().flushThinkingChunks('s2');
    useSessionStore.getState().flushStreamingChunks('s2');
    useSessionStore.getState().setPendingRAAppLaunchIntent(null);

    useSessionStore.getState().startAgentTurn('background-turn', 's2');
    useSessionStore.getState().addTurnItem({ kind: 'tool', callId: 'call-1' }, 's2');
    useSessionStore.getState().finalizeAgentTurn('s2', 'wrong-turn');
    useSessionStore.getState().clearAgentTurns('s2');
    useSessionStore.getState().setAgentTurns([
      { id: 'done-turn', sessionId: 's1', items: [], done: true },
      { id: 'active-turn', sessionId: 's1', items: [], done: false },
    ]);
    expect(useSessionStore.getState().getSessionActiveTurnId('s1')).toBe('active-turn');
    useSessionStore.getState().updateAgentTurn('active-turn', { error: { code: 'TEST', message: 'test' } }, 's2');
    useSessionStore.getState().markAgentTurnError('active-turn', { code: 'TEST', message: 'test' }, 's2');
  });
});
