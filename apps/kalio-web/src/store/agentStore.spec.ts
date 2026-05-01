/**
 * Unit tests for agentStore — per-session pendingConfirmations map.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useAgentStore } from './agentStore';
import type { ToolConfirmationRequest } from '@kalio/types';

function makeReq(sessionId: string, callId = 'call-1'): ToolConfirmationRequest {
  return {
    requestId: `req-${callId}`,
    toolCallId: callId,
    sessionId,
    toolName: 'vfs_write',
    args: { path: '/tmp/file', content: 'hello' },
    timeoutMs: 30000,
  };
}

beforeEach(() => {
  // Reset to clean store state between tests
  useAgentStore.setState({ pendingConfirmations: {} });
});

describe('pendingConfirmations — per-session map', () => {
  it('setting confirmation for session A does not affect session B', () => {
    const { setPendingConfirmation } = useAgentStore.getState();
    const reqA = makeReq('session-A');

    setPendingConfirmation('session-A', reqA);

    const state = useAgentStore.getState();
    expect(state.pendingConfirmations['session-A']).toEqual(reqA);
    expect(state.pendingConfirmations['session-B']).toBeUndefined();
  });

  it('clearing confirmation for session A leaves session B intact', () => {
    const { setPendingConfirmation } = useAgentStore.getState();
    const reqA = makeReq('session-A', 'call-A');
    const reqB = makeReq('session-B', 'call-B');

    setPendingConfirmation('session-A', reqA);
    setPendingConfirmation('session-B', reqB);
    setPendingConfirmation('session-A', null);

    const state = useAgentStore.getState();
    expect(state.pendingConfirmations['session-A']).toBeUndefined();
    expect(state.pendingConfirmations['session-B']).toEqual(reqB);
  });

  it('two sessions can have simultaneous pending confirmations', () => {
    const { setPendingConfirmation } = useAgentStore.getState();
    const reqA = makeReq('session-A', 'call-A');
    const reqB = makeReq('session-B', 'call-B');

    setPendingConfirmation('session-A', reqA);
    setPendingConfirmation('session-B', reqB);

    const state = useAgentStore.getState();
    expect(Object.keys(state.pendingConfirmations)).toHaveLength(2);
    expect(state.pendingConfirmations['session-A']).toEqual(reqA);
    expect(state.pendingConfirmations['session-B']).toEqual(reqB);
  });

  it('setting confirmation for the same session replaces the previous one', () => {
    const { setPendingConfirmation } = useAgentStore.getState();
    const req1 = makeReq('session-A', 'call-1');
    const req2 = makeReq('session-A', 'call-2');

    setPendingConfirmation('session-A', req1);
    setPendingConfirmation('session-A', req2);

    const state = useAgentStore.getState();
    expect(state.pendingConfirmations['session-A']).toEqual(req2);
    expect(Object.keys(state.pendingConfirmations)).toHaveLength(1);
  });

  it('clearing a session that has no confirmation is a no-op', () => {
    const { setPendingConfirmation } = useAgentStore.getState();
    const reqB = makeReq('session-B');
    setPendingConfirmation('session-B', reqB);

    // Should not throw and should not affect session-B
    setPendingConfirmation('session-X', null);

    const state = useAgentStore.getState();
    expect(state.pendingConfirmations['session-B']).toEqual(reqB);
    expect(Object.keys(state.pendingConfirmations)).toHaveLength(1);
  });
});

describe('addToolActivity — Canvas auto-open for run_cli_agent', () => {
  const makeActivity = (toolName: string, callId = 'call-1') => ({
    callId,
    toolName,
    args: { agentId: 'copilot' },
    status: 'running' as const,
    startedAt: Date.now(),
  });

  beforeEach(() => {
    useAgentStore.setState({ canvasOpen: false, toolActivities: [] });
  });

  it('opens canvas when a run_cli_agent activity is added', () => {
    useAgentStore.getState().addToolActivity(makeActivity('run_cli_agent'));
    expect(useAgentStore.getState().canvasOpen).toBe(true);
  });

  it('does NOT open canvas for other tool activities', () => {
    useAgentStore.getState().addToolActivity(makeActivity('vfs_write'));
    expect(useAgentStore.getState().canvasOpen).toBe(false);
  });

  it('opens canvas when updating an existing run_cli_agent activity (dedup path)', () => {
    // Seed with an existing entry
    useAgentStore.setState({
      canvasOpen: false,
      toolActivities: [makeActivity('run_cli_agent', 'c1')],
    });
    // Re-add same callId (update path — dedup logic runs)
    useAgentStore.getState().addToolActivity({ ...makeActivity('run_cli_agent', 'c1'), status: 'success' });
    expect(useAgentStore.getState().canvasOpen).toBe(true);
  });

  it('leaves canvasOpen true if it was already open and another tool fires', () => {
    useAgentStore.setState({ canvasOpen: true, toolActivities: [] });
    useAgentStore.getState().addToolActivity(makeActivity('vfs_read'));
    expect(useAgentStore.getState().canvasOpen).toBe(true);
  });
});
