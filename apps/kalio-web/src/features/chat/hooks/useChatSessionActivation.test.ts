import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useChatSessionActivation } from './useChatSessionActivation';
import { useAgentStore } from '../../../store/agentStore';
import { useSessionStore } from '../../../store/sessionStore';
import { apiClient } from '../../../services/apiClient';
import { eventBus } from '../../../services/eventBus';

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

describe('useChatSessionActivation', () => {
  beforeEach(() => {
    vi.mocked(apiClient.get).mockReset();
    vi.mocked(eventBus.identifySession).mockReset();
    useAgentStore.setState({
      callIdToName: {},
      cliChildProjections: {},
      activeAgentLoops: {},
    });
    useSessionStore.setState({
      activeSessionId: 'session-1',
      sessions: [{ id: 'session-1', personaId: 'default', title: 'Parent', createdAt: 1, updatedAt: 1 }],
      messages: [],
      sessionMessages: { 'session-1': [] },
      agentTurns: [],
      sessionAgentTurns: { 'session-1': [] },
      activeTurnId: null,
      sessionActiveTurnIds: { 'session-1': null },
      getSessionMessages: () => [],
      pendingMessage: null,
      pendingRAAppId: null,
    });
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
      pendingRAAppId: null,
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
});
