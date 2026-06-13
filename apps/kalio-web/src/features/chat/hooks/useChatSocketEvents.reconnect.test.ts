import { describe, it, expect, vi, beforeEach } from 'vitest';
import { waitFor } from '@testing-library/react';
import { useSessionStore } from '../../../store/sessionStore';
import { handleSocketReconnect } from './useChatSocketEvents.reconnect';

describe('handleSocketReconnect', () => {
  beforeEach(() => {
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
  });

  it('rehydrates the architecture timeline during reconnect with the same synthetic summary used after full refresh', async () => {
    const setMessages = vi.fn((messages, sessionId?: string | null) => {
      useSessionStore.getState().setMessages(messages, sessionId);
    });
    const setAgentTurns = vi.fn((turns, sessionId?: string | null) => {
      useSessionStore.getState().setAgentTurns(turns, sessionId);
    });

    handleSocketReconnect({
      cliChild: {
        upsertCLIChildProjection: vi.fn(),
        updateCLIChildProjection: vi.fn(),
        rebuildCLIChildProjections: vi.fn(),
        appendCLIAgentChunk: vi.fn(),
        registerCallId: vi.fn(),
        getAgentState: () => ({
          callIdToName: {},
          toolActivities: [],
          cliChildProjections: {},
          cliAgentOutput: {},
        }),
        getSessionState: () => ({
          activeSessionId: useSessionStore.getState().activeSessionId,
          sessions: useSessionStore.getState().sessions,
        }),
        identifySession: vi.fn(),
      },
      setStreaming: vi.fn(),
      clearToolArgProgressTracking: vi.fn(),
      clearToolActivities: vi.fn(),
      removeActiveAgentLoop: vi.fn(),
      setPendingConfirmation: vi.fn(),
      getActiveSessionId: () => useSessionStore.getState().activeSessionId,
      getSessionMessages: (sessionId) => useSessionStore.getState().getSessionMessages(sessionId),
      setMessages,
      setAgentTurns,
      hasActiveLoopForSession: () => false,
      fetchMessages: async (sessionId) => {
        if (sessionId === 'session-1') {
          return [
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
          ];
        }
        if (sessionId === 'arch-root') {
          return [
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
          ];
        }
        return [];
      },
    });

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
  });
});
