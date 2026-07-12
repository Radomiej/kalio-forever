import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useChatSocketEvents } from './useChatSocketEvents';
import { useAgentStore } from '../../../store/agentStore';
import { useSessionStore } from '../../../store/sessionStore';
import { eventBus } from '../../../services/eventBus';
import { apiClient } from '../../../services/apiClient';
import { clearSessionWatchRegistry } from '../../../services/sessionWatchRegistry';
import { selectPendingApprovalCount } from '../../../store/agentRuntimeSelectors';

type QueuedPayload = { sessionId: string; queueLength: number; position?: number };

const handlers: Record<string, Array<(...args: unknown[]) => void>> = {};

function capture(event: string, handler: (...args: unknown[]) => void) {
  handlers[event] ??= [];
  handlers[event].push(handler);
  return () => {
    handlers[event] = (handlers[event] ?? []).filter((item) => item !== handler);
  };
}

function fire(event: string, payload: unknown) {
  for (const handler of handlers[event] ?? []) {
    handler(payload);
  }
}

vi.mock('../../../services/eventBus', () => ({
  eventBus: {
    connected: true,
    connect: vi.fn(),
    onChunk: (handler: (...args: unknown[]) => void) => capture('chat:chunk', handler),
    onComplete: (handler: (...args: unknown[]) => void) => capture('chat:complete', handler),
    onError: (handler: (...args: unknown[]) => void) => capture('chat:error', handler),
    onToolConfirmation: (handler: (...args: unknown[]) => void) => capture('tool:confirmation_required', handler),
    onToolConfirmationInvalidated: (handler: (...args: unknown[]) => void) => capture('tool:confirmation_invalidated', handler),
    onToolStart: (handler: (...args: unknown[]) => void) => capture('tool:start', handler),
    onToolResult: (handler: (...args: unknown[]) => void) => capture('tool:result', handler),
    onContext: (handler: (...args: unknown[]) => void) => capture('chat:context', handler),
    onAgentStart: (handler: (...args: unknown[]) => void) => capture('agent:start', handler),
    onAgentDone: (handler: (...args: unknown[]) => void) => capture('agent:done', handler),
    onAgentBudgetRequired: (handler: (...args: unknown[]) => void) => capture('agent:budget_required', handler),
    onAgentBudgetInvalidated: (handler: (...args: unknown[]) => void) => capture('agent:budget_invalidated', handler),
    onSessionCreated: (handler: (...args: unknown[]) => void) => capture('session:created', handler),
    onSessionUpdated: (handler: (...args: unknown[]) => void) => capture('session:updated', handler),
    onRaAppNativeResult: (handler: (...args: unknown[]) => void) => capture('raapp:native_result', handler),
    onCLIAgentProgress: (handler: (...args: unknown[]) => void) => capture('cli_agent:progress', handler),
    onToolArgProgress: (handler: (...args: unknown[]) => void) => capture('tool:arg_progress', handler),
    onSessionStatus: (handler: (...args: unknown[]) => void) => capture('session:status', handler),
    onRuntimeActivitySnapshot: (handler: (...args: unknown[]) => void) => capture('session:runtime_snapshot', handler),
    onQueued: (handler: (...args: unknown[]) => void) => capture('chat:queued', handler),
    onReconnect: (handler: (...args: unknown[]) => void) => capture('socket:reconnect', handler),
    onConnectionState: (handler: (...args: unknown[]) => void) => capture('socket:connection_state', handler),
    identifySession: vi.fn(),
    sendMessage: vi.fn(),
    stopTurn: vi.fn(),
    confirmTool: vi.fn(),
    cancelTool: vi.fn(),
    disconnect: vi.fn(),
  },
}));

vi.mock('../../../services/backendHealth', () => ({
  backendHealth: { subscribe: () => () => {}, reportSuccess: vi.fn() },
}));

vi.mock('../../../services/apiClient', () => ({
  apiClient: {
    get: vi.fn(() => Promise.resolve({ data: [] })),
    defaults: { baseURL: '' },
  },
  getApiBaseUrl: () => 'http://localhost:3016',
}));

describe('useChatSocketEvents queue depth (fail-first)', () => {
  beforeEach(() => {
    for (const key of Object.keys(handlers)) {
      delete handlers[key];
    }
    clearSessionWatchRegistry();
    vi.mocked(eventBus.identifySession).mockClear();
    vi.mocked(apiClient.get).mockReset();
    vi.mocked(apiClient.get).mockResolvedValue({ data: [] });
    useAgentStore.setState({ queuedDepthBySession: {}, sessionStatusSnapshots: {} });
    useSessionStore.setState({
      activeSessionId: 'session-1',
      sessions: [
        {
          id: 'session-1',
          personaId: 'default',
          title: 'Test',
          createdAt: 1,
          updatedAt: 1,
        },
        {
          id: 'cli-child-1',
          personaId: 'default',
          title: 'codex CLI',
          kind: 'cli-agent',
          parentSessionId: 'session-1',
          parentToolCallId: 'call-cli-1',
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      sessionMessages: { 'session-1': [] },
      sessionAgentTurns: {},
      streamingChunks: {},
      thinkingChunks: {},
      chunkSessionIds: {},
      getSessionMessages: () => [],
      getSessionActiveTurnId: () => null,
      getSessionAgentTurns: () => [],
      appendChunk: vi.fn(),
      finalizeChunk: vi.fn(),
      addMessage: vi.fn(),
      startAgentTurn: vi.fn(),
      finalizeAgentTurn: vi.fn(),
      markAgentTurnError: vi.fn(),
      removeLastAgentTurn: vi.fn(),
      flushThinkingChunks: vi.fn(),
      flushStreamingChunks: vi.fn(),
      addSession: vi.fn(),
      addTurnItem: vi.fn(),
    });
  });

  function mountHook() {
    const toolArgProgressSeenRef = { current: {} as Record<string, Set<string>> };
    renderHook(() => useChatSocketEvents({
      hasPendingChunksForSession: () => false,
      requestGeneratedTitleIfNeeded: vi.fn(),
      setAwaitingFirstChunk: vi.fn(),
      setConnectionState: vi.fn(),
      setError: vi.fn(),
      setRecoveryNotice: vi.fn(),
      setVfsRefreshSignal: vi.fn(),
      toolArgProgressSeenRef,
    }));
  }

  it('increases and decreases queued depth from successive chat:queued events', () => {
    mountHook();

    act(() => {
      fire('chat:queued', { sessionId: 'session-1', queueLength: 3, position: 3 } satisfies QueuedPayload);
    });
    expect(useAgentStore.getState().queuedDepthBySession['session-1']).toBe(3);

    act(() => {
      fire('chat:queued', { sessionId: 'session-1', queueLength: 1, position: 1 } satisfies QueuedPayload);
    });
    expect(useAgentStore.getState().queuedDepthBySession['session-1']).toBe(1);
  });

  it('resets queued depth to zero when agent:start fires for the session', () => {
    useAgentStore.getState().setQueuedDepth('session-1', 2);
    mountHook();

    act(() => {
      fire('agent:start', {
        sessionId: 'session-1',
        turnId: 'turn-1',
        agentRun: { kind: 'chat' },
      });
    });

    expect(useAgentStore.getState().queuedDepthBySession['session-1']).toBe(0);
  });

  it('keeps budget approvals when agent:done marks a HITL pause', () => {
    mountHook();

    act(() => {
      fire('agent:budget_required', {
        requestId: 'budget-1',
        sessionId: 'session-1',
        scope: 'agent-flow-branch',
        usedIterations: 1,
        currentLimit: 1,
      });
      fire('agent:done', {
        sessionId: 'session-1',
        turnId: 'turn-1',
        agentRun: { kind: 'agent-flow-branch' },
      });
    });

    expect(useAgentStore.getState().pendingBudgetApprovals['session-1']).toEqual([
      expect.objectContaining({ requestId: 'budget-1' }),
    ]);
  });

  it('clears a runId-keyed active loop when chat:error interrupts the session', () => {
    const removeLastAgentTurn = vi.fn();
    useSessionStore.setState({
      getSessionActiveTurnId: () => 'turn-1',
      removeLastAgentTurn,
    });
    mountHook();

    act(() => {
      fire('agent:start', {
        sessionId: 'session-1',
        turnId: 'turn-1',
        agentRun: {
          agentRunId: 'run-1',
          kind: 'chat',
        },
      });
    });

    expect(useAgentStore.getState().hasActiveLoopForSession('session-1')).toBe(true);

    act(() => {
      fire('chat:error', {
        sessionId: 'session-1',
        code: 'INTERRUPTED',
        message: 'Turn interrupted by user',
        hadContent: false,
      });
    });

    expect(useAgentStore.getState().hasActiveLoopForSession('session-1')).toBe(false);
    expect(removeLastAgentTurn).toHaveBeenCalledWith('session-1');
  });

  it('treats QUEUE_DROPPED as queued follow-up cleanup without removing the active turn', () => {
    const removeLastAgentTurn = vi.fn();
    useSessionStore.setState({
      getSessionActiveTurnId: () => 'turn-1',
      removeLastAgentTurn,
    });
    useAgentStore.getState().setQueuedDepth('session-1', 2);
    mountHook();

    act(() => {
      fire('agent:start', {
        sessionId: 'session-1',
        turnId: 'turn-1',
        agentRun: { kind: 'chat' },
      });
    });
    useAgentStore.getState().setQueuedDepth('session-1', 2);

    act(() => {
      fire('chat:error', {
        sessionId: 'session-1',
        code: 'QUEUE_DROPPED',
        message: 'Queued turn was dropped because the session was stopped.',
        hadContent: false,
      });
    });

    expect(useAgentStore.getState().queuedDepthBySession['session-1']).toBe(0);
    expect(useAgentStore.getState().hasActiveLoopForSession('session-1')).toBe(true);
    expect(removeLastAgentTurn).not.toHaveBeenCalled();
  });

  it('materializes the live turn from typed tool:start when agent:start was missed', () => {
    const startAgentTurn = vi.fn();
    const addTurnItem = vi.fn();
    useSessionStore.setState({
      getSessionActiveTurnId: () => null,
      getSessionAgentTurns: () => [],
      startAgentTurn,
      addTurnItem,
    });
    mountHook();

    act(() => {
      fire('tool:start', {
        sessionId: 'session-1',
        turnId: 'turn-tool-1',
        callId: 'call-tool-1',
        toolName: 'run_subagent',
        args: { task: 'child HITL' },
        agentRun: { kind: 'chat' },
      });
    });

    expect(startAgentTurn).toHaveBeenCalledWith('turn-tool-1', 'session-1', { kind: 'chat' });
    expect(addTurnItem).toHaveBeenCalledWith({ kind: 'tool', callId: 'call-tool-1' }, 'session-1');
    expect(useAgentStore.getState().hasActiveLoopForSession('session-1')).toBe(true);
  });

  it('stores replayed inactive descendant session status for sidebar recovery', () => {
    mountHook();

    act(() => {
      fire('session:status', {
        sessionId: 'cli-child-1',
        active: false,
        queueLength: 0,
        run: {
          id: 'run-child',
          sessionId: 'cli-child-1',
          turnId: 'turn-child',
          phase: 'completed',
          status: 'completed',
          retryCount: 0,
          safeResume: true,
          startedAt: 1,
          updatedAt: 2,
          lastHeartbeatAt: 2,
          completedAt: 2,
        },
      });
    });

    expect(useAgentStore.getState().sessionStatusSnapshots['cli-child-1']).toMatchObject({
      sessionId: 'cli-child-1',
      active: false,
      run: {
        status: 'completed',
      },
    });
  });

  it('clears a stale active loop when a terminal runtime snapshot arrives without agent:done', () => {
    useAgentStore.getState().setQueuedDepth('session-1', 2);
    mountHook();

    act(() => {
      fire('agent:start', {
        sessionId: 'session-1',
        turnId: 'turn-1',
        agentRun: { kind: 'chat' },
      });
    });

    expect(useAgentStore.getState().hasActiveLoopForSession('session-1')).toBe(true);
    expect(useAgentStore.getState().isStreaming).toBe(true);

    act(() => {
      fire('session:runtime_snapshot', {
        sessionId: 'session-1',
        active: false,
        turnId: 'turn-1',
        queueLength: 0,
        pendingConfirmations: [],
        pendingBudgetApprovals: [],
        toolActivities: [],
        childExecutions: [],
        updatedAt: 2,
      });
    });

    expect(useAgentStore.getState().hasActiveLoopForSession('session-1')).toBe(false);
    expect(useAgentStore.getState().isStreaming).toBe(false);
    expect(useSessionStore.getState().finalizeAgentTurn).toHaveBeenCalledWith('session-1', 'turn-1');
    expect(useAgentStore.getState().queuedDepthBySession['session-1']).toBe(0);
    expect(useAgentStore.getState().runtimeActivitySnapshots['session-1']).toMatchObject({
      sessionId: 'session-1',
      active: false,
      queueLength: 0,
    });
  });

  it('finalizes a stale active turn when a terminal session status arrives without agent:done', () => {
    mountHook();
    useSessionStore.getState().markSessionHydrated('session-1');

    act(() => {
      fire('agent:start', {
        sessionId: 'session-1',
        turnId: 'turn-1',
        agentRun: { kind: 'chat' },
      });
    });

    act(() => {
      fire('session:status', {
        sessionId: 'session-1',
        active: false,
        queueLength: 0,
        run: {
          id: 'run-1',
          sessionId: 'session-1',
          turnId: 'turn-1',
          phase: 'completed',
          status: 'completed',
          retryCount: 0,
          safeResume: true,
          startedAt: 1,
          updatedAt: 2,
          lastHeartbeatAt: 2,
          completedAt: 2,
        },
      });
    });

    expect(useSessionStore.getState().finalizeAgentTurn).toHaveBeenCalledWith('session-1', undefined);
    expect(useAgentStore.getState().hasActiveLoopForSession('session-1')).toBe(false);
  });

  it('identifies child sessions discovered from live session:updated events', () => {
    mountHook();

    act(() => {
      fire('session:updated', {
        id: 'child-session',
        personaId: 'default',
        title: 'Release Guard: QA',
        kind: 'subagent',
        parentSessionId: 'session-1',
        createdAt: 2,
        updatedAt: 3,
      });
    });

    expect(useSessionStore.getState().addSession).toHaveBeenCalledWith(expect.objectContaining({
      id: 'child-session',
      parentSessionId: 'session-1',
    }));
    expect(eventBus.identifySession).toHaveBeenCalledWith('child-session');
  });

  it('stores child HITL notifications as pending approval live state', () => {
    mountHook();

    act(() => {
      fire('tool:confirmation_required', {
        requestId: 'req-child-hitl',
        toolCallId: 'call-child-hitl',
        sessionId: 'child-session',
        toolName: 'terminal_spawn',
        args: { command: 'npm run build' },
        timeoutMs: 0,
      });
    });

    const state = useAgentStore.getState();
    expect(state.pendingConfirmations['child-session']).toEqual([
      expect.objectContaining({
        requestId: 'req-child-hitl',
        sessionId: 'child-session',
        toolName: 'terminal_spawn',
      }),
    ]);
    expect(state.toolActivities).toContainEqual(expect.objectContaining({
      requestId: 'req-child-hitl',
      sessionId: 'child-session',
      status: 'awaiting_confirmation',
    }));
    expect(selectPendingApprovalCount({
      pendingConfirmations: state.pendingConfirmations,
      pendingBudgetApprovals: state.pendingBudgetApprovals,
    })).toBe(1);
  });
});
