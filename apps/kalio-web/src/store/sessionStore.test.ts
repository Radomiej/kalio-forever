import { describe, it, expect, beforeEach } from 'vitest';
import { useSessionStore } from './sessionStore';

/**
 * Unit tests for AgentTurn management actions in sessionStore.
 * Focuses on the new `markAgentTurnError` and `removeLastAgentTurn` actions
 * added for the execution-tracking error strategy.
 */

function resetStore() {
  useSessionStore.setState({
    agentTurns: [],
    activeTurnId: null,
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
      useSessionStore.getState().startAgentTurn('t1', 's1');
      useSessionStore.getState().finalizeAgentTurn();
      useSessionStore.getState().startAgentTurn('t2', 's1');

      useSessionStore.getState().removeLastAgentTurn();

      const { agentTurns } = useSessionStore.getState();
      expect(agentTurns).toHaveLength(1);
      expect(agentTurns[0].id).toBe('t1');
    });

    it('clears activeTurnId', () => {
      useSessionStore.getState().startAgentTurn('t1', 's1');
      useSessionStore.getState().removeLastAgentTurn();

      expect(useSessionStore.getState().activeTurnId).toBeNull();
    });

    it('is a no-op when agentTurns is empty (does not throw)', () => {
      expect(() => useSessionStore.getState().removeLastAgentTurn()).not.toThrow();
      expect(useSessionStore.getState().agentTurns).toHaveLength(0);
    });
  });
});
