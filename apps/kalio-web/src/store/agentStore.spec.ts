/**
 * Unit tests for agentStore — per-session pending HITL collections.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useAgentStore } from './agentStore';
import type {
  AgentBudgetApprovalRequest,
  AgentRunContext,
  RuntimeActivitySnapshot,
  SocketEvents,
  ToolConfirmationRequest,
} from '@kalio/types';

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

function makeBudgetReq(sessionId: string): AgentBudgetApprovalRequest {
  return {
    requestId: `budget-${sessionId}`,
    sessionId,
    scope: 'chat',
    usedIterations: 4,
    currentLimit: 4,
  };
}

function makeSessionStatusSnapshot(
  overrides: Partial<SocketEvents['session:status']> = {},
): SocketEvents['session:status'] {
  return {
    sessionId: 'session-A',
    active: true,
    turnId: 'turn-1',
    queueLength: 0,
    run: {
      id: 'run-1',
      sessionId: 'session-A',
      turnId: 'turn-1',
      phase: 'llm_streaming',
      status: 'active',
      retryCount: 0,
      safeResume: true,
      startedAt: 100,
      updatedAt: 200,
      lastHeartbeatAt: 200,
    },
    ...overrides,
  };
}

function makeRuntimeActivitySnapshot(
  overrides: Partial<RuntimeActivitySnapshot> = {},
): RuntimeActivitySnapshot {
  return {
    sessionId: 'session-A',
    active: true,
    turnId: 'turn-1',
    queueLength: 1,
    pendingConfirmations: [],
    pendingBudgetApprovals: [],
    toolActivities: [],
    childExecutions: [],
    updatedAt: 300,
    ...overrides,
  };
}

beforeEach(() => {
  // Reset to clean store state between tests
  useAgentStore.setState({ pendingConfirmations: {}, pendingBudgetApprovals: {} });
});

describe('pendingConfirmations — per-session collections', () => {
  it('setting confirmation for session A does not affect session B', () => {
    const { setPendingConfirmation } = useAgentStore.getState();
    const reqA = makeReq('session-A');

    setPendingConfirmation('session-A', reqA);

    const state = useAgentStore.getState();
    expect(state.pendingConfirmations['session-A']).toEqual([reqA]);
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
    expect(state.pendingConfirmations['session-B']).toEqual([reqB]);
  });

  it('two sessions can have simultaneous pending confirmations', () => {
    const { setPendingConfirmation } = useAgentStore.getState();
    const reqA = makeReq('session-A', 'call-A');
    const reqB = makeReq('session-B', 'call-B');

    setPendingConfirmation('session-A', reqA);
    setPendingConfirmation('session-B', reqB);

    const state = useAgentStore.getState();
    expect(Object.keys(state.pendingConfirmations)).toHaveLength(2);
    expect(state.pendingConfirmations['session-A']).toEqual([reqA]);
    expect(state.pendingConfirmations['session-B']).toEqual([reqB]);
  });

  it('setting confirmation for the same session keeps multiple pending requests', () => {
    const { setPendingConfirmation } = useAgentStore.getState();
    const req1 = makeReq('session-A', 'call-1');
    const req2 = makeReq('session-A', 'call-2');

    setPendingConfirmation('session-A', req1);
    setPendingConfirmation('session-A', req2);

    const state = useAgentStore.getState();
    expect(state.pendingConfirmations['session-A']).toEqual([req1, req2]);
    expect(Object.keys(state.pendingConfirmations)).toHaveLength(1);
  });

  it('clearing a session that has no confirmation is a no-op', () => {
    const { setPendingConfirmation } = useAgentStore.getState();
    const reqB = makeReq('session-B');
    setPendingConfirmation('session-B', reqB);

    // Should not throw and should not affect session-B
    setPendingConfirmation('session-X', null);

    const state = useAgentStore.getState();
    expect(state.pendingConfirmations['session-B']).toEqual([reqB]);
    expect(Object.keys(state.pendingConfirmations)).toHaveLength(1);
  });

  it('removes only the targeted confirmation request from a session collection', () => {
    const { setPendingConfirmation, removePendingConfirmation } = useAgentStore.getState();
    const req1 = makeReq('session-A', 'call-1');
    const req2 = makeReq('session-A', 'call-2');

    setPendingConfirmation('session-A', req1);
    setPendingConfirmation('session-A', req2);
    removePendingConfirmation('session-A', req1.requestId);

    const state = useAgentStore.getState();
    expect(state.pendingConfirmations['session-A']).toEqual([req2]);
  });
});

describe('pendingBudgetApprovals — per-session collections', () => {
  it('setting approvals for the same session keeps multiple pending requests', () => {
    const { setPendingBudgetApproval } = useAgentStore.getState();
    const req1 = makeBudgetReq('session-A');
    const req2 = {
      ...makeBudgetReq('session-A'),
      requestId: 'budget-session-A-2',
      usedIterations: 5,
      currentLimit: 5,
    };

    setPendingBudgetApproval('session-A', req1);
    setPendingBudgetApproval('session-A', req2);

    const state = useAgentStore.getState();
    expect(state.pendingBudgetApprovals['session-A']).toEqual([req1, req2]);
  });

  it('removes only the targeted budget approval request from a session collection', () => {
    const { setPendingBudgetApproval, removePendingBudgetApproval } = useAgentStore.getState();
    const req1 = makeBudgetReq('session-A');
    const req2 = {
      ...makeBudgetReq('session-A'),
      requestId: 'budget-session-A-2',
      usedIterations: 5,
      currentLimit: 5,
    };

    setPendingBudgetApproval('session-A', req1);
    setPendingBudgetApproval('session-A', req2);
    removePendingBudgetApproval('session-A', req1.requestId);

    const state = useAgentStore.getState();
    expect(state.pendingBudgetApprovals['session-A']).toEqual([req2]);
  });
});

describe('sessionStatusSnapshots — dedupe noisy heartbeat updates', () => {
  beforeEach(() => {
    useAgentStore.setState({ sessionStatusSnapshots: {}, bufferedSessionStatusSnapshots: {} });
  });

  it('ignores snapshots that only differ by heartbeat timestamps', () => {
    const store = useAgentStore.getState();
    const first = makeSessionStatusSnapshot();
    const noisyHeartbeat = makeSessionStatusSnapshot({
      run: {
        ...first.run!,
        updatedAt: 999,
        lastHeartbeatAt: 999,
      },
    });

    store.setSessionStatusSnapshot(first);
    const storedBefore = useAgentStore.getState().sessionStatusSnapshots['session-A'];
    store.setSessionStatusSnapshot(noisyHeartbeat);
    const storedAfter = useAgentStore.getState().sessionStatusSnapshots['session-A'];

    expect(storedAfter).toBe(storedBefore);
    expect(storedAfter?.run?.updatedAt).toBe(200);
  });

  it('keeps meaningful status transitions', () => {
    const store = useAgentStore.getState();
    const first = makeSessionStatusSnapshot();
    const completed = makeSessionStatusSnapshot({
      active: false,
      run: {
        ...first.run!,
        phase: 'completed',
        status: 'completed',
        completedAt: 500,
      },
    });

    store.setSessionStatusSnapshot(first);
    store.setSessionStatusSnapshot(completed);

    expect(useAgentStore.getState().sessionStatusSnapshots['session-A']).toEqual(completed);
  });

  it('buffers meaningful status transitions in order and drains them once', () => {
    const store = useAgentStore.getState();
    const first = makeSessionStatusSnapshot();
    const noisyHeartbeat = makeSessionStatusSnapshot({
      run: {
        ...first.run!,
        updatedAt: 999,
        lastHeartbeatAt: 999,
      },
    });
    const completed = makeSessionStatusSnapshot({
      active: false,
      run: {
        ...first.run!,
        phase: 'completed',
        status: 'completed',
        completedAt: 500,
      },
    });

    store.recordSessionStatusSnapshot(first);
    store.recordSessionStatusSnapshot(noisyHeartbeat);
    store.recordSessionStatusSnapshot(completed);

    expect(store.consumeBufferedSessionStatusSnapshots('session-A')).toEqual([first, completed]);
    expect(store.consumeBufferedSessionStatusSnapshots('session-A')).toEqual([]);
  });
});

describe('runtimeActivitySnapshots', () => {
  beforeEach(() => {
    useAgentStore.setState({ runtimeActivitySnapshots: {} });
  });

  it('stores the latest rebuildable runtime snapshot by session', () => {
    const store = useAgentStore.getState();
    const first = makeRuntimeActivitySnapshot();
    const second = makeRuntimeActivitySnapshot({
      active: false,
      queueLength: 0,
      updatedAt: 400,
    });

    store.setRuntimeActivitySnapshot(first);
    store.setRuntimeActivitySnapshot(second);

    expect(useAgentStore.getState().runtimeActivitySnapshots['session-A']).toEqual(second);
  });

  it('treats an active runtime snapshot as live session runtime', () => {
    const store = useAgentStore.getState();

    store.setRuntimeActivitySnapshot(makeRuntimeActivitySnapshot({
      run: {
        id: 'run-1',
        sessionId: 'session-A',
        turnId: 'turn-1',
        phase: 'tool_running',
        status: 'active',
        retryCount: 0,
        safeResume: true,
        startedAt: 100,
        updatedAt: 200,
        lastHeartbeatAt: 200,
      },
    }));

    expect(useAgentStore.getState().hasActiveLoopForSession('session-A')).toBe(true);
  });

  it('rebuilds pending HITL state, queue depth, and tool activities from the runtime snapshot', () => {
    const store = useAgentStore.getState();
    const confirmation = makeReq('session-A', 'call-runtime');
    const budgetReq = makeBudgetReq('session-A');

    store.setRuntimeActivitySnapshot(makeRuntimeActivitySnapshot({
      queueLength: 3,
      pendingConfirmations: [confirmation],
      pendingBudgetApprovals: [budgetReq],
      toolActivities: [{
        callId: 'call-runtime',
        requestId: confirmation.requestId,
        sessionId: 'session-A',
        toolName: 'vfs_write',
        args: { path: '/tmp/file', content: 'hello' },
        status: 'pending_confirmation',
        startedAt: 123,
      }],
    }));

    const state = useAgentStore.getState();
    expect(state.pendingConfirmations['session-A']).toEqual([confirmation]);
    expect(state.pendingBudgetApprovals['session-A']).toEqual([budgetReq]);
    expect(state.queuedDepthBySession['session-A']).toBe(3);
    expect(state.getToolActivitiesForSession('session-A')).toEqual([
      expect.objectContaining({
        callId: 'call-runtime',
        requestId: confirmation.requestId,
        status: 'awaiting_confirmation',
      }),
    ]);
  });

  it('does not restore a locally settled confirmation from a delayed runtime snapshot', () => {
    const store = useAgentStore.getState();
    const confirmation = makeReq('session-A', 'call-settled');

    store.setPendingConfirmation('session-A', confirmation);
    store.removePendingConfirmation('session-A', confirmation.requestId);
    store.setRuntimeActivitySnapshot(makeRuntimeActivitySnapshot({
      pendingConfirmations: [confirmation],
      toolActivities: [{
        callId: confirmation.toolCallId,
        requestId: confirmation.requestId,
        sessionId: 'session-A',
        toolName: confirmation.toolName,
        args: confirmation.args,
        status: 'pending_confirmation',
        startedAt: 123,
      }],
    }));

    const state = useAgentStore.getState();
    expect(state.pendingConfirmations['session-A']).toBeUndefined();
    expect(state.getToolActivitiesForSession('session-A')).toEqual([]);
  });

  it('rebuilds multiple confirmations and budget approvals from one runtime snapshot', () => {
    const store = useAgentStore.getState();
    const confirmationA = makeReq('session-A', 'call-runtime-1');
    const confirmationB = makeReq('session-A', 'call-runtime-2');
    const budgetA = makeBudgetReq('session-A');
    const budgetB = {
      ...makeBudgetReq('session-A'),
      requestId: 'budget-session-A-2',
      usedIterations: 5,
      currentLimit: 5,
    };

    store.setRuntimeActivitySnapshot(makeRuntimeActivitySnapshot({
      pendingConfirmations: [confirmationA, confirmationB],
      pendingBudgetApprovals: [budgetA, budgetB],
    }));

    const state = useAgentStore.getState();
    expect(state.pendingConfirmations['session-A']).toEqual([confirmationA, confirmationB]);
    expect(state.pendingBudgetApprovals['session-A']).toEqual([budgetA, budgetB]);
  });

  it('projects live tool and loop mutations back into the runtime snapshot between server snapshots', () => {
    const store = useAgentStore.getState();

    store.setRuntimeActivitySnapshot(makeRuntimeActivitySnapshot({
      active: false,
      queueLength: 0,
      toolActivities: [],
    }));

    store.addActiveAgentLoop('session-A', 'turn-live');
    store.addToolActivity({
      callId: 'call-live',
      toolName: 'vfs_write',
      args: { path: '/tmp/live', content: 'runtime' },
      sessionId: 'session-A',
      status: 'running',
      startedAt: 100,
    });
    store.updateToolActivity('call-live', {
      status: 'success',
      finishedAt: 200,
    });

    let runtimeSnapshot = useAgentStore.getState().runtimeActivitySnapshots['session-A'];
    expect(runtimeSnapshot).toMatchObject({
      active: true,
      turnId: 'turn-live',
      toolActivities: [
        expect.objectContaining({
          callId: 'call-live',
          status: 'success',
          finishedAt: 200,
        }),
      ],
    });

    store.removeActiveAgentLoop('session-A');
    runtimeSnapshot = useAgentStore.getState().runtimeActivitySnapshots['session-A'];
    expect(runtimeSnapshot?.active).toBe(false);
  });

  it('projects live CLI child updates back into the parent runtime snapshot', () => {
    const store = useAgentStore.getState();

    store.upsertCLIChildProjection({
      childSessionId: 'cli-child-1',
      parentSessionId: 'session-A',
      parentCallId: 'call-cli',
      agentId: 'codex',
      status: 'running',
      lastOutput: 'partial output',
      toolName: 'run_cli_agent',
    });

    let runtimeSnapshot = useAgentStore.getState().runtimeActivitySnapshots['session-A'];
    expect(runtimeSnapshot?.childExecutions).toEqual([
      expect.objectContaining({
        kind: 'cli_agent',
        childSessionId: 'cli-child-1',
        parentToolCallId: 'call-cli',
        label: 'codex',
        status: 'running',
        lastOutput: 'partial output',
      }),
    ]);

    store.updateCLIChildProjection('cli-child-1', {
      status: 'completed',
      lastOutput: 'finished output',
    });

    runtimeSnapshot = useAgentStore.getState().runtimeActivitySnapshots['session-A'];
    expect(runtimeSnapshot?.childExecutions).toEqual([
      expect.objectContaining({
        kind: 'cli_agent',
        childSessionId: 'cli-child-1',
        parentToolCallId: 'call-cli',
        status: 'completed',
        lastOutput: 'finished output',
      }),
    ]);
  });

  it('updates the runtime snapshot from session status replays for live and terminal recovery state', () => {
    const store = useAgentStore.getState();
    const completed = makeSessionStatusSnapshot({
      active: false,
      queueLength: 2,
      run: {
        ...makeSessionStatusSnapshot().run!,
        phase: 'completed',
        status: 'completed',
        completedAt: 500,
      },
    });

    store.setRuntimeActivitySnapshot(makeRuntimeActivitySnapshot({
      active: true,
      turnId: 'turn-stale',
      queueLength: 0,
    }));
    store.recordSessionStatusSnapshot(completed);

    expect(useAgentStore.getState().runtimeActivitySnapshots['session-A']).toMatchObject({
      active: false,
      turnId: 'turn-1',
      queueLength: 2,
      run: completed.run,
    });
  });
});

describe('session-scoped streaming isolation', () => {
  beforeEach(() => {
    useAgentStore.setState({
      isStreaming: false,
      streamingMessageId: undefined,
      streamingSessionId: null,
    });
  });

  it('does not clear streaming when another session stops', () => {
    const store = useAgentStore.getState();

    store.setStreaming(true, undefined, 'session-A');
    store.setStreaming(false, undefined, 'session-B');

    const state = useAgentStore.getState();
    expect(state.isStreaming).toBe(true);
    expect(state.streamingSessionId).toBe('session-A');
  });

  it('clears streaming when the matching session stops', () => {
    const store = useAgentStore.getState();

    store.setStreaming(true, undefined, 'session-A');
    store.setStreaming(false, undefined, 'session-A');

    const state = useAgentStore.getState();
    expect(state.isStreaming).toBe(false);
    expect(state.streamingSessionId).toBeNull();
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

  it('opens canvas when a durable CLI tool activity is added', () => {
    useAgentStore.getState().addToolActivity(makeActivity('spawn_cli_agent'));
    expect(useAgentStore.getState().canvasOpen).toBe(true);
  });

  it('opens canvas for durable CLI follow-up tools too', () => {
    const toolNames = ['message_cli_agent', 'get_cli_agent_status', 'stop_cli_agent'];

    toolNames.forEach((toolName) => {
      useAgentStore.setState({ canvasOpen: false, toolActivities: [] });
      useAgentStore.getState().addToolActivity(makeActivity(toolName));
      expect(useAgentStore.getState().canvasOpen).toBe(true);
    });
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

describe('subagent run tracking', () => {
  const subagentRun: AgentRunContext = {
    agentRunId: 'subagent-run-1',
    agentType: 'subagent',
    parentSessionId: 'master-session',
    parentToolCallId: 'call-subagent',
    vfsMode: 'isolated',
    vfsSessionId: 'child-session',
  };

  beforeEach(() => {
    useAgentStore.setState({ activeAgentLoops: {}, canvasOpen: false, toolActivities: [] });
  });

  it('keys active loops by agentRunId when metadata is present', () => {
    useAgentStore.getState().addActiveAgentLoop('child-session', 'turn-1', subagentRun);

    const state = useAgentStore.getState();
    expect(state.activeAgentLoops['subagent-run-1']).toMatchObject({
      sessionId: 'child-session',
      turnId: 'turn-1',
      agentRun: subagentRun,
    });
    expect(state.activeAgentLoops['child-session']).toBeUndefined();
  });

  it('removes active loops by agentRunId when metadata is present', () => {
    const store = useAgentStore.getState();
    store.addActiveAgentLoop('child-session', 'turn-1', subagentRun);
    store.removeActiveAgentLoop('child-session', subagentRun);

    expect(useAgentStore.getState().activeAgentLoops['subagent-run-1']).toBeUndefined();
  });

  it('removes active loops by sessionId when terminal events do not carry agentRun metadata', () => {
    const store = useAgentStore.getState();
    store.addActiveAgentLoop('child-session', 'turn-1', subagentRun);

    store.removeActiveAgentLoop('child-session');

    expect(useAgentStore.getState().activeAgentLoops['subagent-run-1']).toBeUndefined();
    expect(useAgentStore.getState().hasActiveLoopForSession('child-session')).toBe(false);
  });

  it('projects live subagent loops back into parent runtime child executions', () => {
    const store = useAgentStore.getState();

    store.addActiveAgentLoop('child-session', 'turn-1', subagentRun);

    let runtimeSnapshot = useAgentStore.getState().runtimeActivitySnapshots['master-session'];
    expect(runtimeSnapshot?.childExecutions).toEqual([
      expect.objectContaining({
        kind: 'subagent',
        childSessionId: 'child-session',
        parentToolCallId: 'call-subagent',
        status: 'running',
      }),
    ]);

    store.removeActiveAgentLoop('child-session');

    runtimeSnapshot = useAgentStore.getState().runtimeActivitySnapshots['master-session'];
    expect(runtimeSnapshot?.childExecutions).toEqual([
      expect.objectContaining({
        kind: 'subagent',
        childSessionId: 'child-session',
        parentToolCallId: 'call-subagent',
        status: 'completed',
      }),
    ]);
  });

  it('opens canvas for subagent tool activity', () => {
    useAgentStore.getState().addToolActivity({
      callId: 'call-sub',
      toolName: 'vfs_write',
      args: {},
      status: 'running',
      startedAt: Date.now(),
      sessionId: 'child-session',
      agentRun: subagentRun,
    });

    expect(useAgentStore.getState().canvasOpen).toBe(true);
  });
});

describe('per-session tool activities (REGRESSION)', () => {
  const makeSessionAwareStore = () => useAgentStore.getState();

  beforeEach(() => {
    useAgentStore.setState({ canvasOpen: false, toolActivities: [] });
  });

  it('clearToolActivities(sessionId) preserves other sessions', () => {
    const store = makeSessionAwareStore();

    store.addToolActivity({
      callId: 'call-parent',
      toolName: 'vfs_write',
      args: {},
      status: 'running',
      startedAt: 1,
      sessionId: 'sess-parent',
    });
    store.addToolActivity({
      callId: 'call-child',
      toolName: 'run_subagent',
      args: {},
      status: 'running',
      startedAt: 2,
      sessionId: 'sess-child',
    });

    store.clearToolActivities('sess-parent');

    expect(store.getToolActivitiesForSession('sess-parent')).toEqual([]);
    expect(store.getToolActivitiesForSession('sess-child')).toEqual([
      expect.objectContaining({ callId: 'call-child' }),
    ]);
  });
});

describe('agentStore input validation gaps (REGRESSION)', () => {
  beforeEach(() => {
    useAgentStore.setState({
      toolActivities: [],
      sessionToolActivities: {},
      callIdToName: {},
      cliAgentOutput: {},
      pendingConfirmations: {},
      canvasOpen: false,
    });
  });

  it('does not collapse distinct tool activities onto an empty callId', () => {
    const store = useAgentStore.getState();

    store.addToolActivity({
      callId: '',
      toolName: 'vfs_read',
      args: { path: '/tmp/a.txt' },
      status: 'running',
      startedAt: 1,
    });
    store.addToolActivity({
      callId: '',
      toolName: 'vfs_write',
      args: { path: '/tmp/b.txt', content: 'hello' },
      status: 'running',
      startedAt: 2,
    });

    expect(useAgentStore.getState().toolActivities).toHaveLength(2);
  });

  it('ignores blank session keys for pending confirmations', () => {
    useAgentStore.getState().setPendingConfirmation('', makeReq('session-A'));

    expect(useAgentStore.getState().pendingConfirmations).toEqual({});
  });

  it('does not notify subscribers when blank session keys are ignored', () => {
    const listener = vi.fn();
    const unsubscribe = useAgentStore.subscribe(listener);

    useAgentStore.getState().setPendingConfirmation('', makeReq('session-A'));

    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('ignores blank callIds when registering tool names', () => {
    useAgentStore.getState().registerCallId('', 'run_raapp');

    expect(useAgentStore.getState().callIdToName).toEqual({});
  });

  it('does not notify subscribers when blank callIds are ignored during registerCallId', () => {
    const listener = vi.fn();
    const unsubscribe = useAgentStore.subscribe(listener);

    useAgentStore.getState().registerCallId('', 'run_raapp');

    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('ignores blank callIds when appending CLI agent output', () => {
    useAgentStore.getState().appendCLIAgentChunk('', 'partial output');

    expect(useAgentStore.getState().cliAgentOutput).toEqual({});
  });

  it('does not notify subscribers when blank callIds are ignored during appendCLIAgentChunk', () => {
    const listener = vi.fn();
    const unsubscribe = useAgentStore.subscribe(listener);

    useAgentStore.getState().appendCLIAgentChunk('', 'partial output');

    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });
});
