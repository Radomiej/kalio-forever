import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useRef } from 'react';
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
}));

describe('useChatSocketEvents queue depth (fail-first)', () => {
  beforeEach(() => {
    for (const key of Object.keys(handlers)) {
      delete handlers[key];
    }
    vi.mocked(eventBus.identifySession).mockClear();
    vi.mocked(apiClient.get).mockReset();
    vi.mocked(apiClient.get).mockResolvedValue({ data: [] });
    useAgentStore.setState({ queuedDepthBySession: {} });
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
      messagesBySession: { 'session-1': [] },
      agentTurnsBySession: {},
      streamingChunks: {},
      thinkingChunks: {},
      chunkSessionIds: {},
      pendingChunksBySession: {},
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

  it('updates CLI child projection to stopped when a cancelled tool:result carries the final snapshot', () => {
    useAgentStore.setState({
      cliChildProjections: {
        'cli-child-1': {
          childSessionId: 'cli-child-1',
          parentSessionId: 'session-1',
          parentCallId: 'call-cli-1',
          agentId: 'codex',
          status: 'running',
          lastOutput: 'still running',
          toolName: 'run_cli_agent',
        },
      },
      callIdToName: {
        'call-cli-1': 'run_cli_agent',
      },
    });
    mountHook();

    act(() => {
      fire('tool:result', {
        callId: 'call-cli-1',
        sessionId: 'cli-child-1',
        status: 'cancelled',
        data: {
          childSessionId: 'cli-child-1',
          parentSessionId: 'session-1',
          agentId: 'codex',
          workdir: 'C:/repo',
          status: 'stopped',
          lastPrompt: 'Long running task',
          updatedAt: 123,
          lastOutput: 'CLI agent stopped.',
        },
      });
    });

    expect(useAgentStore.getState().cliChildProjections['cli-child-1']).toMatchObject({
      status: 'stopped',
      lastOutput: 'CLI agent stopped.',
    });
  });

  it('rebuilds CLI child projections and re-identifies child sessions after reconnect', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({
      data: [
        {
          id: 'tool-1',
          sessionId: 'session-1',
          role: 'tool_result',
          toolCallId: 'call-cli-1',
          content: JSON.stringify({
            childSessionId: 'cli-child-1',
            parentSessionId: 'session-1',
            agentId: 'codex',
            workdir: 'C:/repo',
            status: 'completed',
            lastPrompt: 'Inspect repository',
            updatedAt: 100,
            lastOutput: 'done',
          }),
          createdAt: 1,
        },
      ],
    });
    useAgentStore.setState({
      callIdToName: {
        'call-cli-1': 'spawn_cli_agent',
      },
      cliChildProjections: {},
    });
    mountHook();

    await act(async () => {
      fire('socket:reconnect', undefined);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(eventBus.identifySession).toHaveBeenCalledWith('session-1');
    expect(eventBus.identifySession).toHaveBeenCalledWith('cli-child-1');
    expect(useAgentStore.getState().cliChildProjections['cli-child-1']).toMatchObject({
      childSessionId: 'cli-child-1',
      parentSessionId: 'session-1',
      parentCallId: 'call-cli-1',
      status: 'completed',
      lastOutput: 'done',
      toolName: 'spawn_cli_agent',
    });
  });
});
