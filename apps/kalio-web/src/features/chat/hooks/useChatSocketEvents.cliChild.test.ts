import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useChatSocketEvents } from './useChatSocketEvents';
import { rebuildCliChildProjectionsFromHistory } from './useChatSocketEvents.cliChild';
import { useAgentStore } from '../../../store/agentStore';
import { useSessionStore } from '../../../store/sessionStore';
import { eventBus } from '../../../services/eventBus';
import { apiClient } from '../../../services/apiClient';

const handlers: Record<string, Array<(...args: unknown[]) => void>> = {};
const mockIdentifySession = vi.hoisted(() => vi.fn());

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
    onRuntimeActivitySnapshot: (handler: (...args: unknown[]) => void) => capture('session:runtime_snapshot', handler),
    onReconnect: (handler: (...args: unknown[]) => void) => capture('socket:reconnect', handler),
    onConnectionState: (handler: (...args: unknown[]) => void) => capture('socket:connection_state', handler),
    identifySession: mockIdentifySession,
    sendMessage: vi.fn(),
    stopTurn: vi.fn(),
    confirmTool: vi.fn(),
    cancelTool: vi.fn(),
    disconnect: vi.fn(),
  },
}));

vi.mock('../../../services/sessionWatchRegistry', () => ({
  identifyWatchedSession: (sessionId: string) => {
    if (sessionId.trim().length > 0) {
      mockIdentifySession(sessionId);
    }
  },
  replaceBaselineWatchedSessions: vi.fn(),
  resetSessionWatchConnectionEpoch: vi.fn(),
  clearSessionWatchRegistry: vi.fn(),
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

describe('useChatSocketEvents CLI child projections', () => {
  beforeEach(() => {
    for (const key of Object.keys(handlers)) {
      delete handlers[key];
    }
    vi.mocked(eventBus.identifySession).mockClear();
    vi.mocked(apiClient.get).mockReset();
    vi.mocked(apiClient.get).mockResolvedValue({ data: [] });
    useAgentStore.setState({
      queuedDepthBySession: {},
      cliChildProjections: {},
      cliAgentOutput: {},
      callIdToName: {},
      toolActivities: [],
    });
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
      setMessages: vi.fn(),
      setAgentTurns: vi.fn(),
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

  it('treats cancelled tool:result as terminal even when the snapshot still says running', () => {
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
          status: 'running',
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

  it('updates CLI child projection to failed when an error tool:result carries the final snapshot', () => {
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
        toolName: 'run_cli_agent',
        sessionId: 'cli-child-1',
        status: 'error',
        errorCode: 'CLI_AGENT_ERROR',
        errorMessage: 'CLI process exited with code 1',
        data: {
          childSessionId: 'cli-child-1',
          parentSessionId: 'session-1',
          agentId: 'codex',
          workdir: 'C:/repo',
          status: 'failed',
          lastPrompt: 'Long running task',
          updatedAt: 123,
          lastOutput: 'CLI process exited with code 1',
        },
      });
    });

    expect(useAgentStore.getState().cliChildProjections['cli-child-1']).toMatchObject({
      status: 'failed',
      lastOutput: 'CLI process exited with code 1',
    });
  });

  it('rebuilds a failed CLI child projection from persisted tool-result status metadata', () => {
    useAgentStore.setState({
      callIdToName: {
        'call-cli-1': 'spawn_cli_agent',
      },
    });

    const deps = {
      upsertCLIChildProjection: vi.fn(),
      updateCLIChildProjection: vi.fn(),
      rebuildCLIChildProjections: (parentSessionId: string, projections: Array<unknown>) => {
        void parentSessionId;
        useAgentStore.getState().rebuildCLIChildProjections('session-1', projections as never);
      },
      appendCLIAgentChunk: vi.fn(),
      registerCallId: vi.fn(),
      getAgentState: () => useAgentStore.getState(),
      getSessionState: () => useSessionStore.getState(),
      identifySession: vi.fn(),
    };

    rebuildCliChildProjectionsFromHistory(deps, 'session-1', [
      {
        id: 'assistant-1',
        sessionId: 'session-1',
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'call-cli-1', name: 'spawn_cli_agent', args: { agentId: 'codex' } }],
        createdAt: 1,
      },
      {
        id: 'tool-1',
        sessionId: 'session-1',
        role: 'tool_result',
        toolCallId: 'call-cli-1',
        content: JSON.stringify({
          childSessionId: 'cli-child-1',
          parentSessionId: 'session-1',
          agentId: 'codex',
          status: 'running',
          toolResultStatus: 'error',
          lastOutput: 'Authentication required.',
        }),
        createdAt: 2,
      },
    ]);

    expect(useAgentStore.getState().cliChildProjections['cli-child-1']).toMatchObject({
      status: 'failed',
      lastOutput: 'Authentication required.',
    });
  });

  it('patches CLI child projection to failed when error tool:result has no snapshot data', () => {
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
    });
    mountHook();

    act(() => {
      fire('tool:result', {
        callId: 'call-cli-1',
        toolName: 'run_cli_agent',
        sessionId: 'cli-child-1',
        status: 'error',
        errorCode: 'CLI_AGENT_ERROR',
        errorMessage: 'CLI process exited with code 1',
      });
    });

    expect(useAgentStore.getState().cliChildProjections['cli-child-1']).toMatchObject({
      status: 'failed',
      lastOutput: 'CLI process exited with code 1',
    });
  });

  it('does not double-append cli_agent:progress chunks into projection lastOutput', () => {
    useAgentStore.setState({
      cliChildProjections: {
        'cli-child-1': {
          childSessionId: 'cli-child-1',
          parentSessionId: 'session-1',
          parentCallId: 'call-cli-1',
          agentId: 'codex',
          status: 'running',
          lastOutput: '',
          toolName: 'run_cli_agent',
        },
      },
    });
    mountHook();

    act(() => {
      fire('cli_agent:progress', {
        callId: 'call-cli-1',
        sessionId: 'cli-child-1',
        turnId: 'turn-cli-1',
        agentId: 'codex',
        chunk: 'line-1\n',
      });
      fire('cli_agent:progress', {
        callId: 'call-cli-1',
        sessionId: 'cli-child-1',
        turnId: 'turn-cli-1',
        agentId: 'codex',
        chunk: 'line-2\n',
      });
    });

    expect(useAgentStore.getState().cliChildProjections['cli-child-1']?.lastOutput).toBe('line-1\nline-2\n');
    expect(useAgentStore.getState().cliChildProjections['cli-child-1']?.turnId).toBe('turn-cli-1');
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

  it('rebuilds CLI child projections from assistant tool_calls when callIdToName is empty on reconnect', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({
      data: [
        {
          id: 'assistant-1',
          sessionId: 'session-1',
          role: 'assistant',
          content: '',
          toolCalls: [{ id: 'call-cli-1', name: 'spawn_cli_agent', args: { agentId: 'codex' } }],
          createdAt: 1,
        },
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
          createdAt: 2,
        },
      ],
    });
    mountHook();

    await act(async () => {
      fire('socket:reconnect', undefined);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(useAgentStore.getState().callIdToName['call-cli-1']).toBe('spawn_cli_agent');
    expect(useAgentStore.getState().cliChildProjections['cli-child-1']).toMatchObject({
      status: 'completed',
      lastOutput: 'done',
      toolName: 'spawn_cli_agent',
    });
  });

  it('identifies CLI child sessions discovered only from fetched reconnect history', async () => {
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
      ],
      sessionMessages: { 'session-1': [] },
    });
    vi.mocked(apiClient.get).mockResolvedValue({
      data: [
        {
          id: 'assistant-1',
          sessionId: 'session-1',
          role: 'assistant',
          content: '',
          toolCalls: [{ id: 'call-cli-1', name: 'spawn_cli_agent', args: { agentId: 'codex' } }],
          createdAt: 1,
        },
        {
          id: 'tool-1',
          sessionId: 'session-1',
          role: 'tool_result',
          toolCallId: 'call-cli-1',
          content: JSON.stringify({
            childSessionId: 'cli-child-history-only',
            parentSessionId: 'session-1',
            agentId: 'codex',
            workdir: 'C:/repo',
            status: 'running',
            lastPrompt: 'Inspect repository',
            updatedAt: 100,
            lastOutput: 'working',
          }),
          createdAt: 2,
        },
      ],
    });
    mountHook();

    await act(async () => {
      fire('socket:reconnect', undefined);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(eventBus.identifySession).toHaveBeenCalledWith('session-1');
    expect(eventBus.identifySession).toHaveBeenCalledWith('cli-child-history-only');
    expect(useAgentStore.getState().cliChildProjections['cli-child-history-only']).toMatchObject({
      status: 'running',
      toolName: 'spawn_cli_agent',
    });
  });
});
