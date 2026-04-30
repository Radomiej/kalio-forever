import { describe, it, expect, beforeEach } from 'vitest';
import { useSessionStore } from './sessionStore';

function resetStore() {
  useSessionStore.setState({
    agentTurns: [],
    activeTurnId: null,
    activeSessionId: null,
  });
}

describe('sessionStore — AgentTurn actions', () => {
  beforeEach(resetStore);

  describe('startAgentTurn', () => {
    it('appends a new turn and sets activeTurnId', () => {
      useSessionStore.getState().startAgentTurn('t1', 's1');
      const { agentTurns, activeTurnId } = useSessionStore.getState();
      expect(agentTurns).toHaveLength(1);
      expect(agentTurns[0]).toMatchObject({ id: 't1', sessionId: 's1', items: [], done: false });
      expect(activeTurnId).toBe('t1');
    });
  });

  describe('finalizeAgentTurn', () => {
    it('marks the active turn as done and clears activeTurnId', () => {
      useSessionStore.getState().startAgentTurn('t1', 's1');
      useSessionStore.getState().finalizeAgentTurn();
      const { agentTurns, activeTurnId } = useSessionStore.getState();
      expect(agentTurns[0].done).toBe(true);
      expect(activeTurnId).toBeNull();
    });
  });

  describe('markAgentTurnError', () => {
    it('sets error on the matching turn without changing other turns', () => {
      useSessionStore.getState().startAgentTurn('t1', 's1');
      useSessionStore.getState().finalizeAgentTurn();
      useSessionStore.getState().startAgentTurn('t2', 's1');

      useSessionStore.getState().markAgentTurnError('t1', { code: 'INTERRUPTED', message: 'Interrupted' });

      const { agentTurns } = useSessionStore.getState();
      expect(agentTurns[0].error).toEqual({ code: 'INTERRUPTED', message: 'Interrupted' });
      expect(agentTurns[1].error).toBeUndefined();
    });

    it('is a no-op for an unknown turnId', () => {
      useSessionStore.getState().startAgentTurn('t1', 's1');
      useSessionStore.getState().markAgentTurnError('unknown', { code: 'LLM_ERROR', message: 'fail' });

      const { agentTurns } = useSessionStore.getState();
      expect(agentTurns[0].error).toBeUndefined();
    });

    it('does not change activeTurnId', () => {
      useSessionStore.getState().startAgentTurn('t1', 's1');
      useSessionStore.getState().markAgentTurnError('t1', { code: 'MAX_ITERATIONS_REACHED', message: 'too many' });

      expect(useSessionStore.getState().activeTurnId).toBe('t1');
    });
  });

  describe('removeLastAgentTurn', () => {
    it('removes the last turn from agentTurns', () => {
      useSessionStore.setState({ activeSessionId: 's1' });
      useSessionStore.getState().startAgentTurn('t1', 's1');
      useSessionStore.getState().finalizeAgentTurn();
      useSessionStore.getState().startAgentTurn('t2', 's1');

      useSessionStore.getState().removeLastAgentTurn();

      const { agentTurns } = useSessionStore.getState();
      expect(agentTurns).toHaveLength(1);
      expect(agentTurns[0].id).toBe('t1');
    });

    it('clears activeTurnId', () => {
      useSessionStore.setState({ activeSessionId: 's1' });
      useSessionStore.getState().startAgentTurn('t1', 's1');
      useSessionStore.getState().removeLastAgentTurn();

      expect(useSessionStore.getState().activeTurnId).toBeNull();
    });

    it('is a no-op when agentTurns is empty (does not throw)', () => {
      useSessionStore.setState({ activeSessionId: 's1' });
      expect(() => useSessionStore.getState().removeLastAgentTurn()).not.toThrow();
      expect(useSessionStore.getState().agentTurns).toHaveLength(0);
    });

    it('only removes the last turn for the active session, leaves other-session turns intact', () => {
      // s1 has two turns, s2 has one turn
      useSessionStore.setState({
        activeSessionId: 's1',
        agentTurns: [
          { id: 'a1', sessionId: 's1', items: [], done: true },
          { id: 'b1', sessionId: 's2', items: [], done: true },
          { id: 'a2', sessionId: 's1', items: [], done: false },
        ],
        activeTurnId: 'a2',
      });

      useSessionStore.getState().removeLastAgentTurn();

      const { agentTurns, activeTurnId } = useSessionStore.getState();
      expect(agentTurns.map((t) => t.id)).toEqual(['a1', 'b1']);
      expect(activeTurnId).toBeNull();
    });

    it('does not touch turns from another session when active session has no turns', () => {
      useSessionStore.setState({
        activeSessionId: 's2',
        agentTurns: [
          { id: 'a1', sessionId: 's1', items: [], done: true },
        ],
        activeTurnId: null,
      });

      useSessionStore.getState().removeLastAgentTurn();

      expect(useSessionStore.getState().agentTurns).toHaveLength(1);
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
});
