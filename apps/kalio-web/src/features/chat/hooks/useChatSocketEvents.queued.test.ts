import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useChatSocketEvents } from './useChatSocketEvents';
import { useAgentStore } from '../../../store/agentStore';
import { useSessionStore } from '../../../store/sessionStore';
import { eventBus } from '../../../services/eventBus';
import { apiClient } from '../../../services/apiClient';

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
    onSessionCreated: (handler: (...args: unknown[]) => void) => capture('session:created', handler),
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
});
