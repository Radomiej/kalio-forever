import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ToolConfirmationRequest } from '@kalio/types';
import { useChatSessionActivation } from './useChatSessionActivation';
import { useAgentStore } from '../../../store/agentStore';
import { useSessionStore } from '../../../store/sessionStore';
import { apiClient } from '../../../services/apiClient';
import { eventBus } from '../../../services/eventBus';
import { backendHealth } from '../../../services/backendHealth';
import { clearSessionWatchRegistry } from '../../../services/sessionWatchRegistry';
import { createPendingHostSession } from '../pendingHostSession';

const { reportBackendSuccess, reportBackendFailure } = vi.hoisted(() => ({
  reportBackendSuccess: vi.fn(),
  reportBackendFailure: vi.fn(),
}));

vi.mock('../../../services/apiClient', () => ({
  apiClient: {
    get: vi.fn(),
  },
}));

vi.mock('../../../services/eventBus', () => ({
  eventBus: {
    identifySession: vi.fn(),
  },
}));

vi.mock('../../../services/backendHealth', () => ({
  backendHealth: {
    reportSuccess: reportBackendSuccess,
    reportFailure: reportBackendFailure,
  },
}));

describe('useChatSessionActivation', () => {
  beforeEach(() => {
    vi.mocked(apiClient.get).mockReset();
    vi.mocked(eventBus.identifySession).mockReset();
    vi.mocked(backendHealth.reportSuccess).mockReset();
    vi.mocked(backendHealth.reportFailure).mockReset();
    clearSessionWatchRegistry();
    useAgentStore.setState({
      callIdToName: {},
      cliChildProjections: {},
      activeAgentLoops: {},
      pendingConfirmations: {},
      runtimeActivitySnapshots: {},
    });
    useSessionStore.setState({
      activeSessionId: 'session-1',
      sessions: [{ id: 'session-1', personaId: 'default', title: 'Parent', createdAt: 1, updatedAt: 1 }],
      messages: [],
      sessionMessages: { 'session-1': [] },
      hydratedSessionIds: {},
      agentTurns: [],
      sessionAgentTurns: { 'session-1': [] },
      activeTurnId: null,
      sessionActiveTurnIds: { 'session-1': null },
      getSessionMessages: () => [],
      pendingMessage: null,
    });
  });

  it('identifies the active session before history hydration completes', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({ data: [] });

    renderHook(() => useChatSessionActivation({
      activeSessionId: 'session-1',
      clearToolActivities: vi.fn(),
      handleSendRef: { current: vi.fn() },
      setAgentTurns: vi.fn(),
      setMessages: vi.fn(),
      setPendingConfirmation: vi.fn(),
      updateAgentTurn: vi.fn(),
    }));

    expect(eventBus.identifySession).toHaveBeenCalledWith('session-1');
    await waitFor(() => {
      expect(apiClient.get).toHaveBeenCalledWith('/api/sessions/session-1/messages', expect.objectContaining({
        params: { limit: 40 },
      }));
    });
  });

  it('identifies the parent when a child session is selected so backend can replay the child tree', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({ data: [] });
    useSessionStore.setState({
      activeSessionId: 'child-session-1',
      sessions: [
        { id: 'parent-session-1', personaId: 'default', title: 'Parent', createdAt: 1, updatedAt: 1 },
        {
          id: 'child-session-1',
          personaId: 'default',
          title: 'Child',
          kind: 'subagent',
          parentSessionId: 'parent-session-1',
          createdAt: 2,
          updatedAt: 2,
        },
      ],
      sessionMessages: {
        'parent-session-1': [],
        'child-session-1': [],
      },
    });

    renderHook(() => useChatSessionActivation({
      activeSessionId: 'child-session-1',
      clearToolActivities: vi.fn(),
      handleSendRef: { current: vi.fn() },
      setAgentTurns: vi.fn(),
      setMessages: vi.fn(),
      setPendingConfirmation: vi.fn(),
      updateAgentTurn: vi.fn(),
    }));

    expect(eventBus.identifySession).toHaveBeenCalledWith('child-session-1');
    expect(eventBus.identifySession).toHaveBeenCalledWith('parent-session-1');
    await waitFor(() => {
      expect(apiClient.get).toHaveBeenCalledWith('/api/sessions/child-session-1/messages', expect.objectContaining({
        params: { limit: 40 },
      }));
    });
  });

  it('skips history hydration for pending host-session ids', async () => {
    const pendingSession = createPendingHostSession({
      personaId: 'default',
      now: 1,
    });
    renderHook(() => useChatSessionActivation({
      activeSessionId: pendingSession.id,
      clearToolActivities: vi.fn(),
      handleSendRef: { current: vi.fn() },
      setAgentTurns: vi.fn(),
      setMessages: vi.fn(),
      setPendingConfirmation: vi.fn(),
      updateAgentTurn: vi.fn(),
    }));

    await act(async () => {
      await Promise.resolve();
    });

    expect(eventBus.identifySession).not.toHaveBeenCalled();
    expect(apiClient.get).not.toHaveBeenCalled();
    expect(backendHealth.reportSuccess).not.toHaveBeenCalled();
    expect(backendHealth.reportFailure).not.toHaveBeenCalled();
  });

  it('rebuilds CLI child projections when session history is loaded', async () => {
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
            status: 'stopped',
            lastPrompt: 'Inspect repo',
            updatedAt: 100,
            lastOutput: 'CLI agent stopped.',
          }),
          createdAt: 2,
        },
      ],
    });

    const handleSendRef = { current: vi.fn() };
    renderHook(() => useChatSessionActivation({
      activeSessionId: 'session-1',
      clearToolActivities: vi.fn(),
      handleSendRef,
      setAgentTurns: vi.fn(),
      setMessages: vi.fn(),
      setPendingConfirmation: vi.fn(),
      updateAgentTurn: vi.fn(),
    }));

    await waitFor(() => {
      expect(useAgentStore.getState().cliChildProjections['cli-child-1']).toMatchObject({
        status: 'stopped',
        lastOutput: 'CLI agent stopped.',
        toolName: 'spawn_cli_agent',
      });
    });
    expect(useAgentStore.getState().callIdToName['call-cli-1']).toBe('spawn_cli_agent');
    expect(backendHealth.reportSuccess).toHaveBeenCalled();
  });

  it('reports backend failure when activation history hydration fails', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.mocked(apiClient.get).mockRejectedValue(new Error('backend refused connection'));

    renderHook(() => useChatSessionActivation({
      activeSessionId: 'session-1',
      clearToolActivities: vi.fn(),
      handleSendRef: { current: vi.fn() },
      setAgentTurns: vi.fn(),
      setMessages: vi.fn(),
      setPendingConfirmation: vi.fn(),
      updateAgentTurn: vi.fn(),
    }));

    await waitFor(() => {
      expect(backendHealth.reportFailure).toHaveBeenCalled();
    });
    expect(errorSpy).toHaveBeenCalledWith('[ChatInterface] failed to load message history', expect.any(Error));
  });

  it('does not clear pending confirmation restored from runtime snapshot on activation', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({ data: [] });
    const pending: ToolConfirmationRequest = {
      requestId: 'req-replay',
      toolCallId: 'call-replay',
      sessionId: 'session-1',
      toolName: 'image_generate',
      args: { prompt: 'Generate a coffee poster' },
      timeoutMs: 600000,
    };
    useAgentStore.setState({
      pendingConfirmations: { 'session-1': [pending] },
      runtimeActivitySnapshots: {
        'session-1': {
          sessionId: 'session-1',
          active: false,
          queueLength: 0,
          pendingConfirmations: [pending],
          pendingBudgetApprovals: [],
          toolActivities: [{
            callId: pending.toolCallId,
            requestId: pending.requestId,
            sessionId: pending.sessionId,
            toolName: pending.toolName,
            args: pending.args,
            status: 'pending_confirmation',
            startedAt: 100,
          }],
          childExecutions: [],
          updatedAt: 100,
        },
      },
    });

    const setPendingConfirmation = vi.fn();
    const clearToolActivities = vi.fn();
    renderHook(() => useChatSessionActivation({
      activeSessionId: 'session-1',
      clearToolActivities,
      handleSendRef: { current: vi.fn() },
      setAgentTurns: vi.fn(),
      setMessages: vi.fn(),
      setPendingConfirmation,
      updateAgentTurn: vi.fn(),
    }));

    await waitFor(() => {
      expect(apiClient.get).toHaveBeenCalledWith('/api/sessions/session-1/messages', expect.objectContaining({
        params: { limit: 40 },
      }));
    });
    expect(setPendingConfirmation).not.toHaveBeenCalledWith('session-1', null);
    expect(clearToolActivities).not.toHaveBeenCalledWith('session-1');
  });

  it('keeps restored running tool activity while clearing stale pending confirmation state on activation', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({ data: [] });
    useAgentStore.setState({
      runtimeActivitySnapshots: {
        'session-1': {
          sessionId: 'session-1',
          active: true,
          turnId: 'turn-live',
          queueLength: 0,
          pendingConfirmations: [],
          pendingBudgetApprovals: [],
          toolActivities: [{
            callId: 'call-running',
            requestId: 'req-running',
            sessionId: 'session-1',
            toolName: 'terminal_exec',
            args: { command: 'dir' },
            status: 'running',
            startedAt: 100,
          }],
          childExecutions: [],
          updatedAt: 100,
        },
      },
    });

    const setPendingConfirmation = vi.fn();
    const clearToolActivities = vi.fn();
    renderHook(() => useChatSessionActivation({
      activeSessionId: 'session-1',
      clearToolActivities,
      handleSendRef: { current: vi.fn() },
      setAgentTurns: vi.fn(),
      setMessages: vi.fn(),
      setPendingConfirmation,
      updateAgentTurn: vi.fn(),
    }));

    await waitFor(() => {
      expect(apiClient.get).toHaveBeenCalledWith('/api/sessions/session-1/messages', expect.objectContaining({
        params: { limit: 40 },
      }));
    });
    expect(clearToolActivities).not.toHaveBeenCalledWith('session-1');
    expect(setPendingConfirmation).toHaveBeenCalledWith('session-1', null);
  });

  it('auto-sends a pending RA-App launch intent that arrives after the session is already active', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({ data: [] });

    const handleSendRef = { current: vi.fn() };
    renderHook(() => useChatSessionActivation({
      activeSessionId: 'session-1',
      clearToolActivities: vi.fn(),
      handleSendRef,
      setAgentTurns: vi.fn(),
      setMessages: vi.fn(),
      setPendingConfirmation: vi.fn(),
      updateAgentTurn: vi.fn(),
    }));

    await waitFor(() => {
      expect(apiClient.get).toHaveBeenCalledWith('/api/sessions/session-1/messages', expect.objectContaining({
        params: { limit: 40 },
      }));
    });

    handleSendRef.current.mockClear();

    act(() => {
      useSessionStore.getState().setPendingRAAppLaunchIntent({
        targetSessionId: 'session-1',
        appId: 'visual-calculator',
        appName: 'Visual Calculator',
        personaId: 'ra-apps',
        prompt: 'Run the "Visual Calculator" RA-App for me.',
        source: 'home_tile',
      });
    });

    await waitFor(() => {
      expect(handleSendRef.current).toHaveBeenCalledWith(
        'Run the "Visual Calculator" RA-App for me.\n\nUse run_raapp with the exact id "visual-calculator" now. Do not choose a different RA-App id unless this exact id is missing.',
        'ra-apps',
      );
    });
    expect(useSessionStore.getState().pendingRAAppLaunchIntent).toBeNull();
  });

  it('identifies rebuilt CLI child sessions discovered only from loaded history', async () => {
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
            lastPrompt: 'Inspect repo',
            updatedAt: 100,
            lastOutput: 'working',
          }),
          createdAt: 2,
        },
      ],
    });

    const handleSendRef = { current: vi.fn() };
    renderHook(() => useChatSessionActivation({
      activeSessionId: 'session-1',
      clearToolActivities: vi.fn(),
      handleSendRef,
      setAgentTurns: vi.fn(),
      setMessages: vi.fn(),
      setPendingConfirmation: vi.fn(),
      updateAgentTurn: vi.fn(),
    }));

    await waitFor(() => {
      expect(useAgentStore.getState().cliChildProjections['cli-child-history-only']).toMatchObject({
        status: 'running',
        toolName: 'spawn_cli_agent',
      });
    });
    expect(eventBus.identifySession).toHaveBeenCalledWith('cli-child-history-only');
  });

  it('rebuilds a terminal CLI child projection from persisted tool-result status metadata after reload', async () => {
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
            status: 'running',
            toolResultStatus: 'error',
            lastPrompt: 'Inspect repo',
            updatedAt: 100,
            lastOutput: 'Authentication required.',
          }),
          createdAt: 2,
        },
      ],
    });

    const handleSendRef = { current: vi.fn() };
    renderHook(() => useChatSessionActivation({
      activeSessionId: 'session-1',
      clearToolActivities: vi.fn(),
      handleSendRef,
      setAgentTurns: vi.fn(),
      setMessages: vi.fn(),
      setPendingConfirmation: vi.fn(),
      updateAgentTurn: vi.fn(),
    }));

    await waitFor(() => {
      expect(useAgentStore.getState().cliChildProjections['cli-child-1']).toMatchObject({
        status: 'failed',
        lastOutput: 'Authentication required.',
      });
    });
  });

  it('backfills promptMessageId for an active recovered turn after history load', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({
      data: [
        {
          id: 'user-1',
          sessionId: 'session-1',
          role: 'user',
          content: 'Need more tool calls.',
          createdAt: 1,
        },
      ],
    });
    useAgentStore.setState({
      activeAgentLoops: {
        'session-1': {
          sessionId: 'session-1',
          turnId: 'turn-live',
          startedAt: 1,
        },
      },
    });
    useSessionStore.setState({
      sessionAgentTurns: {
        'session-1': [{
          id: 'turn-live',
          sessionId: 'session-1',
          items: [],
          done: false,
        }],
      },
      sessionActiveTurnIds: {
        'session-1': 'turn-live',
      },
      agentTurns: [{
        id: 'turn-live',
        sessionId: 'session-1',
        items: [],
        done: false,
      }],
      activeTurnId: 'turn-live',
    });

    const updateAgentTurn = vi.fn();
    const handleSendRef = { current: vi.fn() };
    renderHook(() => useChatSessionActivation({
      activeSessionId: 'session-1',
      clearToolActivities: vi.fn(),
      handleSendRef,
      setAgentTurns: vi.fn(),
      setMessages: vi.fn(),
      setPendingConfirmation: vi.fn(),
      updateAgentTurn,
    }));

    await waitFor(() => {
      expect(updateAgentTurn).toHaveBeenCalledWith('turn-live', { promptMessageId: 'user-1' }, 'session-1');
    });
  });

  it('prefers persisted turn linkage over latest-user fallback when recovering an active turn', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({
      data: [
        {
          id: 'user-1',
          sessionId: 'session-1',
          role: 'user',
          content: 'Original prompt.',
          turnId: 'turn-live',
          promptMessageId: 'user-1',
          createdAt: 1,
        },
        {
          id: 'user-2',
          sessionId: 'session-1',
          role: 'user',
          content: 'Queued follow-up.',
          turnId: 'turn-next',
          promptMessageId: 'user-2',
          createdAt: 2,
        },
        {
          id: 'assistant-1',
          sessionId: 'session-1',
          role: 'assistant',
          content: 'Answer for the original prompt.',
          turnId: 'turn-live',
          promptMessageId: 'user-1',
          createdAt: 3,
        },
      ],
    });
    useAgentStore.setState({
      activeAgentLoops: {
        'session-1': {
          sessionId: 'session-1',
          turnId: 'turn-live',
          startedAt: 1,
        },
      },
    });
    useSessionStore.setState({
      sessionAgentTurns: {
        'session-1': [{
          id: 'turn-live',
          sessionId: 'session-1',
          items: [],
          done: false,
        }],
      },
      sessionActiveTurnIds: {
        'session-1': 'turn-live',
      },
      agentTurns: [{
        id: 'turn-live',
        sessionId: 'session-1',
        items: [],
        done: false,
      }],
      activeTurnId: 'turn-live',
    });

    const updateAgentTurn = vi.fn();
    renderHook(() => useChatSessionActivation({
      activeSessionId: 'session-1',
      clearToolActivities: vi.fn(),
      handleSendRef: { current: vi.fn() },
      setAgentTurns: vi.fn(),
      setMessages: vi.fn(),
      setPendingConfirmation: vi.fn(),
      updateAgentTurn,
    }));

    await waitFor(() => {
      expect(updateAgentTurn).toHaveBeenCalledWith('turn-live', { promptMessageId: 'user-1' }, 'session-1');
    });
  });

  it('rehydrates architecture timeline metadata from a direct child session after reload', async () => {
    useSessionStore.setState({
      activeSessionId: 'session-1',
      sessions: [
        { id: 'session-1', personaId: 'default', title: 'Parent', createdAt: 1, updatedAt: 1 },
        {
          id: 'arch-root',
          personaId: 'default',
          title: 'Architecture: Strategic Decision Council',
          parentSessionId: 'session-1',
          kind: 'agent-flow',
          runtimeContext: {
            runtimeKind: 'agent-flow-branch',
            architectureContext: { architectureRunId: 'run-live', displayLabel: 'Strategic Decision Council' },
          },
          createdAt: 2,
          updatedAt: 2,
        },
      ],
      messages: [],
      sessionMessages: { 'session-1': [], 'arch-root': [] },
      agentTurns: [],
      sessionAgentTurns: { 'session-1': [], 'arch-root': [] },
      activeTurnId: null,
      sessionActiveTurnIds: { 'session-1': null, 'arch-root': null },
      pendingMessage: null,
    });
    vi.mocked(apiClient.get).mockImplementation(async (url: string) => {
      if (url === '/api/sessions/session-1/messages') {
        return {
          data: [
            {
              id: 'user-1',
              sessionId: 'session-1',
              role: 'user',
              content: 'Plan it.',
              createdAt: 1,
            },
            {
              id: 'assistant-final',
              sessionId: 'session-1',
              role: 'assistant',
              content: 'Final recommendation.',
              createdAt: 5,
            },
          ],
        };
      }
      if (url === '/api/sessions/arch-root/messages') {
        return {
          data: [
            {
              id: 'arch-summary',
              sessionId: 'arch-root',
              role: 'assistant',
              content: '',
              architectureRun: {
                runId: 'run-live',
                schemaId: 'Strategic Decision Council',
                status: 'running',
                trace: [],
                routeHops: [],
                graphNodes: [
                  { id: 'router', label: 'Router', kind: 'router', status: 'running', eventIds: ['event-router'] },
                  { id: 'analyst', label: 'Analyst', kind: 'role', status: 'pending', eventIds: [] },
                ],
                graphEdges: [],
              },
              createdAt: 3,
            },
          ],
        };
      }
      return { data: [] };
    });

    const setMessages = vi.fn();
    const setAgentTurns = vi.fn();
    renderHook(() => useChatSessionActivation({
      activeSessionId: 'session-1',
      clearToolActivities: vi.fn(),
      handleSendRef: { current: vi.fn() },
      setAgentTurns,
      setMessages,
      setPendingConfirmation: vi.fn(),
      updateAgentTurn: vi.fn(),
    }));

    await waitFor(() => {
      expect(setMessages).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'architecture-rehydrate:session-1:run-live',
            architectureRun: expect.objectContaining({
              runId: 'run-live',
              status: 'running',
            }),
          }),
        ]),
        'session-1',
      );
    });
    expect(setMessages).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ id: 'arch-summary', sessionId: 'arch-root' }),
      ]),
      'arch-root',
    );
    expect(setAgentTurns).toHaveBeenCalledWith(expect.any(Array), 'arch-root');
  });

  it('rebuilds workflow-envelope turns from hydrated history even when a live turn placeholder still exists', async () => {
    useAgentStore.setState({
      activeAgentLoops: {
        'session-1': {
          sessionId: 'session-1',
          turnId: 'turn-live',
          startedAt: 1,
        },
      },
    });
    useSessionStore.setState({
      activeSessionId: 'session-1',
      sessions: [
        { id: 'session-1', personaId: 'default', title: 'Parent', createdAt: 1, updatedAt: 1 },
      ],
      messages: [],
      sessionMessages: { 'session-1': [] },
      agentTurns: [{
        id: 'turn-live',
        sessionId: 'session-1',
        items: [],
        done: false,
      }],
      sessionAgentTurns: {
        'session-1': [{
          id: 'turn-live',
          sessionId: 'session-1',
          items: [],
          done: false,
        }],
      },
      activeTurnId: 'turn-live',
      sessionActiveTurnIds: { 'session-1': 'turn-live' },
      pendingMessage: null,
    });
    vi.mocked(apiClient.get).mockResolvedValue({
      data: [
        {
          id: 'user-1',
          sessionId: 'session-1',
          role: 'user',
          content: 'Assess this repository.',
          createdAt: 1,
        },
        {
          id: 'assistant-tools',
          sessionId: 'session-1',
          role: 'assistant',
          content: '',
          createdAt: 2,
          toolCalls: [
            {
              id: 'architecture:run-live:event-pragmatist',
              name: 'run_subagent',
              args: {
                architectureRunId: 'run-live',
                schemaName: 'Strategic Decision Council',
                nodeId: 'pragmatist',
                childSessionId: 'arch-pragmatist',
              },
            },
          ],
        },
        {
          id: 'tool-result-1',
          sessionId: 'session-1',
          role: 'tool_result',
          toolCallId: 'architecture:run-live:event-pragmatist',
          content: JSON.stringify({
            result: 'Pragmatist answer.',
            taskId: 'run-live:event-pragmatist',
            childSessionId: 'arch-pragmatist',
            parentSessionId: 'session-1',
            vfsMode: 'shared',
            vfsSessionId: 'session-1',
            copiedFiles: [],
            durationMs: 0,
          }),
          createdAt: 3,
        },
        {
          id: 'router-1',
          sessionId: 'session-1',
          role: 'assistant',
          content: '### Router\n\nRoute selected.',
          createdAt: 4,
        },
        {
          id: 'finalizer-1',
          sessionId: 'session-1',
          role: 'assistant',
          content: '### Finalizer\n\nFinal answer.',
          createdAt: 5,
        },
      ],
    });

    const setAgentTurns = vi.fn();
    renderHook(() => useChatSessionActivation({
      activeSessionId: 'session-1',
      clearToolActivities: vi.fn(),
      handleSendRef: { current: vi.fn() },
      setAgentTurns,
      setMessages: vi.fn(),
      setPendingConfirmation: vi.fn(),
      updateAgentTurn: vi.fn(),
    }));

    await waitFor(() => {
      expect(setAgentTurns).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            sessionId: 'session-1',
            turnKind: 'workflow-envelope',
          }),
        ]),
        'session-1',
      );
    });
  });

  it('does not wipe a live follow-up workflow turn when hydrated history still only contains the previous completed run', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({
      data: [
        {
          id: 'user-1',
          sessionId: 'session-1',
          role: 'user',
          content: 'First workflow prompt.',
          createdAt: 1,
        },
        {
          id: 'arch-old',
          sessionId: 'session-1',
          role: 'assistant',
          content: '',
          createdAt: 2,
          architectureRun: {
            runId: 'run-old',
            schemaId: 'strategic-decision-council',
            status: 'completed',
            hostProjectionKind: 'workflow-envelope',
            finalArtifact: 'Old final answer',
            trace: [],
            routeHops: [],
          },
        },
        {
          id: 'user-2',
          sessionId: 'session-1',
          role: 'user',
          content: 'Follow-up workflow prompt.',
          createdAt: 3,
        },
      ],
    });
    useAgentStore.setState({
      activeAgentLoops: {
        'session-1': {
          sessionId: 'session-1',
          turnId: 'turn-new',
          startedAt: 4,
        },
      },
    });
    useSessionStore.setState({
      activeSessionId: 'session-1',
      sessions: [{ id: 'session-1', personaId: 'default', title: 'Parent', createdAt: 1, updatedAt: 4 }],
      messages: [],
      sessionMessages: { 'session-1': [] },
      agentTurns: [
        {
          id: 'turn-old',
          sessionId: 'session-1',
          promptMessageId: 'user-1',
          turnKind: 'workflow-envelope',
          items: [{ kind: 'text', messageId: 'arch-old' }],
          done: true,
        },
        {
          id: 'turn-new',
          sessionId: 'session-1',
          promptMessageId: 'user-2',
          turnKind: 'workflow-envelope',
          items: [{ kind: 'text', messageId: 'architecture:user-2:pending' }],
          done: false,
        },
      ],
      sessionAgentTurns: {
        'session-1': [
          {
            id: 'turn-old',
            sessionId: 'session-1',
            promptMessageId: 'user-1',
            turnKind: 'workflow-envelope',
            items: [{ kind: 'text', messageId: 'arch-old' }],
            done: true,
          },
          {
            id: 'turn-new',
            sessionId: 'session-1',
            promptMessageId: 'user-2',
            turnKind: 'workflow-envelope',
            items: [{ kind: 'text', messageId: 'architecture:user-2:pending' }],
            done: false,
          },
        ],
      },
      activeTurnId: 'turn-new',
      sessionActiveTurnIds: { 'session-1': 'turn-new' },
      pendingMessage: null,
    });

    const setAgentTurns = vi.fn();
    renderHook(() => useChatSessionActivation({
      activeSessionId: 'session-1',
      clearToolActivities: vi.fn(),
      handleSendRef: { current: vi.fn() },
      setAgentTurns,
      setMessages: vi.fn(),
      setPendingConfirmation: vi.fn(),
      updateAgentTurn: vi.fn(),
    }));

    await waitFor(() => {
      expect(apiClient.get).toHaveBeenCalledWith('/api/sessions/session-1/messages', expect.objectContaining({
        params: { limit: 40 },
      }));
    });
    expect(setAgentTurns).not.toHaveBeenCalled();
  });

  it('restores a live turn from the latest active session status snapshot after hydration', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({
      data: [
        {
          id: 'user-1',
          sessionId: 'session-1',
          role: 'user',
          content: 'Continue.',
          createdAt: 1,
        },
      ],
    });
    useAgentStore.setState({
      sessionStatusSnapshots: {
        'session-1': {
          sessionId: 'session-1',
          active: true,
          turnId: 'turn-restored',
          queueLength: 0,
        },
      },
      activeAgentLoops: {},
    });
    useSessionStore.setState({
      sessionAgentTurns: {
        'session-1': [],
      },
      sessionActiveTurnIds: {
        'session-1': null,
      },
      agentTurns: [],
      activeTurnId: null,
    });

    const handleSendRef = { current: vi.fn() };
    renderHook(() => useChatSessionActivation({
      activeSessionId: 'session-1',
      clearToolActivities: vi.fn(),
      handleSendRef,
      setAgentTurns: useSessionStore.getState().setAgentTurns,
      setMessages: useSessionStore.getState().setMessages,
      setPendingConfirmation: vi.fn(),
      updateAgentTurn: vi.fn(),
    }));

    await waitFor(() => {
      expect(useAgentStore.getState().hasActiveLoopForSession('session-1')).toBe(true);
      expect(useSessionStore.getState().getSessionActiveTurnId('session-1')).toBe('turn-restored');
    });
    expect(useAgentStore.getState()).toMatchObject({
      isStreaming: true,
      streamingSessionId: 'session-1',
    });
  });

  it('prefers the runtime snapshot over stale buffered session status after hydration', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({
      data: [
        {
          id: 'user-1',
          sessionId: 'session-1',
          role: 'user',
          content: 'Continue.',
          createdAt: 1,
        },
      ],
    });
    useAgentStore.setState({
      runtimeActivitySnapshots: {
        'session-1': {
          sessionId: 'session-1',
          active: false,
          turnId: 'turn-completed',
          queueLength: 0,
          pendingConfirmations: [],
          pendingBudgetApprovals: [],
          toolActivities: [],
          childExecutions: [],
          updatedAt: 100,
        },
      },
      sessionStatusSnapshots: {
        'session-1': {
          sessionId: 'session-1',
          active: false,
          turnId: 'turn-completed',
          queueLength: 0,
        },
      },
      bufferedSessionStatusSnapshots: {
        'session-1': [
          {
            sessionId: 'session-1',
            active: true,
            turnId: 'turn-stale',
            queueLength: 0,
          },
        ],
      },
      activeAgentLoops: {},
    });
    useSessionStore.setState({
      sessionAgentTurns: {
        'session-1': [],
      },
      sessionActiveTurnIds: {
        'session-1': null,
      },
      agentTurns: [],
      activeTurnId: null,
    });

    renderHook(() => useChatSessionActivation({
      activeSessionId: 'session-1',
      clearToolActivities: vi.fn(),
      handleSendRef: { current: vi.fn() },
      setAgentTurns: useSessionStore.getState().setAgentTurns,
      setMessages: useSessionStore.getState().setMessages,
      setPendingConfirmation: vi.fn(),
      updateAgentTurn: vi.fn(),
    }));

    await waitFor(() => {
      expect(apiClient.get).toHaveBeenCalledWith('/api/sessions/session-1/messages', expect.objectContaining({
        params: { limit: 40 },
      }));
    });
    expect(useAgentStore.getState().hasActiveLoopForSession('session-1')).toBe(false);
    expect(useSessionStore.getState().getSessionActiveTurnId('session-1')).toBeNull();
    expect(useAgentStore.getState().consumeBufferedSessionStatusSnapshots('session-1')).toEqual([]);
  });

  it('replays buffered session status snapshots from the store after hydration', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({
      data: [
        {
          id: 'user-1',
          sessionId: 'session-1',
          role: 'user',
          content: 'Continue.',
          createdAt: 1,
        },
      ],
    });
    useAgentStore.setState({
      runtimeActivitySnapshots: {},
      sessionStatusSnapshots: {
        'session-1': {
          sessionId: 'session-1',
          active: false,
          turnId: 'turn-buffered',
          queueLength: 0,
        },
      },
      bufferedSessionStatusSnapshots: {
        'session-1': [
          {
            sessionId: 'session-1',
            active: true,
            turnId: 'turn-buffered',
            queueLength: 0,
          },
        ],
      },
      activeAgentLoops: {},
    });
    useSessionStore.setState({
      sessionAgentTurns: {
        'session-1': [],
      },
      sessionActiveTurnIds: {
        'session-1': null,
      },
      agentTurns: [],
      activeTurnId: null,
    });

    renderHook(() => useChatSessionActivation({
      activeSessionId: 'session-1',
      clearToolActivities: vi.fn(),
      handleSendRef: { current: vi.fn() },
      setAgentTurns: useSessionStore.getState().setAgentTurns,
      setMessages: useSessionStore.getState().setMessages,
      setPendingConfirmation: vi.fn(),
      updateAgentTurn: vi.fn(),
    }));

    await waitFor(() => {
      expect(useAgentStore.getState().hasActiveLoopForSession('session-1')).toBe(true);
      expect(useSessionStore.getState().getSessionActiveTurnId('session-1')).toBe('turn-buffered');
    });
    expect(useAgentStore.getState()).toMatchObject({
      isStreaming: true,
      streamingSessionId: 'session-1',
    });
    expect(useAgentStore.getState().consumeBufferedSessionStatusSnapshots('session-1')).toEqual([]);
  });
});
