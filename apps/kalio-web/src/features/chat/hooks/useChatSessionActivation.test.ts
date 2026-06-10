import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useChatSessionActivation } from './useChatSessionActivation';
import { useAgentStore } from '../../../store/agentStore';
import { useSessionStore } from '../../../store/sessionStore';
import { apiClient } from '../../../services/apiClient';

vi.mock('../../../services/apiClient', () => ({
  apiClient: {
    get: vi.fn(),
  },
}));

describe('useChatSessionActivation', () => {
  beforeEach(() => {
    vi.mocked(apiClient.get).mockReset();
    useAgentStore.setState({
      callIdToName: {},
      cliChildProjections: {},
    });
    useSessionStore.setState({
      activeSessionId: 'session-1',
      sessions: [{ id: 'session-1', personaId: 'default', title: 'Parent', createdAt: 1, updatedAt: 1 }],
      messages: [],
      sessionMessages: { 'session-1': [] },
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
});
