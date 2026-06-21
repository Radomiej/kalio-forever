import { describe, it, expect, vi, beforeEach } from 'vitest';
import { waitFor } from '@testing-library/react';
import type { ChatMessage } from '@kalio/types';
import { useAgentStore } from '../../../store/agentStore';
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
    });
  });

  it('rehydrates the architecture timeline during reconnect with the same synthetic summary used after full refresh', async () => {
    const setSessions = vi.fn((sessions) => {
      useSessionStore.getState().setSessions(sessions);
    });
    const setActiveSession = vi.fn((sessionId: string) => {
      useSessionStore.getState().setActiveSession(sessionId);
    });
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
      setActiveSession,
      setSessions,
      getActiveSessionId: () => useSessionStore.getState().activeSessionId,
      getSessionMessages: (sessionId) => useSessionStore.getState().getSessionMessages(sessionId),
      setMessages,
      setAgentTurns,
      hasActiveLoopForSession: () => false,
      fetchSessions: async () => [
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
        {
          id: 'arch-analyst',
          personaId: 'default',
          title: 'Strategic Decision Council: Analyst',
          parentSessionId: 'arch-root',
          kind: 'subagent',
          runtimeContext: {
            runtimeKind: 'agent-flow-branch',
            parentToolCallId: 'architecture:run-live:analyst',
            architectureSlotId: 'analyst',
          },
          createdAt: 3,
          updatedAt: 3,
        },
      ],
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
    expect(setSessions).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ id: 'arch-root', parentSessionId: 'session-1' }),
      expect.objectContaining({ id: 'arch-analyst', parentSessionId: 'arch-root' }),
    ]));
    expect(setMessages).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ id: 'arch-summary', sessionId: 'arch-root' }),
      ]),
      'arch-root',
    );
    expect(setActiveSession).not.toHaveBeenCalled();
  });

  it('normalizes an active architecture envelope session back to the host session during reconnect', async () => {
    useSessionStore.setState({
      activeSessionId: 'arch-root',
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

    const setActiveSession = vi.fn((sessionId: string) => {
      useSessionStore.getState().setActiveSession(sessionId);
    });
    const setSessions = vi.fn((sessions) => {
      useSessionStore.getState().setSessions(sessions);
    });
    const setMessages = vi.fn((messages, sessionId?: string | null) => {
      useSessionStore.getState().setMessages(messages, sessionId);
    });
    const setAgentTurns = vi.fn((turns, sessionId?: string | null) => {
      useSessionStore.getState().setAgentTurns(turns, sessionId);
    });

    const identifySession = vi.fn();

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
        identifySession,
      },
      setStreaming: vi.fn(),
      clearToolArgProgressTracking: vi.fn(),
      clearToolActivities: vi.fn(),
      removeActiveAgentLoop: vi.fn(),
      setPendingConfirmation: vi.fn(),
      setActiveSession,
      setSessions,
      getActiveSessionId: () => useSessionStore.getState().activeSessionId,
      getSessionMessages: (sessionId) => useSessionStore.getState().getSessionMessages(sessionId),
      setMessages,
      setAgentTurns,
      hasActiveLoopForSession: () => false,
      fetchSessions: async () => [
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
      fetchMessages: async (sessionId) => {
        if (sessionId === 'session-1') {
          return [
            { id: 'user-1', sessionId: 'session-1', role: 'user', content: 'Plan it.', createdAt: 1 },
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

    await waitFor(() => expect(setActiveSession).toHaveBeenCalledWith('session-1'));
    expect(identifySession).toHaveBeenCalledWith('session-1');
    await waitFor(() => {
      expect(setMessages).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'architecture-rehydrate:session-1:run-live',
            architectureRun: expect.objectContaining({ runId: 'run-live' }),
          }),
        ]),
        'session-1',
      );
    });
  });

  it('still reloads history when the optional session refresh fails', async () => {
    const fetchMessages = vi.fn(async (): Promise<ChatMessage[]> => [
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
    ]);
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
      setSessions: vi.fn(),
      getActiveSessionId: () => useSessionStore.getState().activeSessionId,
      getSessionMessages: (sessionId) => useSessionStore.getState().getSessionMessages(sessionId),
      setMessages,
      setAgentTurns,
      hasActiveLoopForSession: () => false,
      fetchSessions: async () => {
        throw new Error('sessions unavailable');
      },
      fetchMessages,
    });

    await waitFor(() => expect(fetchMessages).toHaveBeenCalledWith('session-1'));
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

  it('rebuilds workflow-envelope turns from hydrated reconnect history even while the live loop is still marked active', async () => {
    useSessionStore.setState({
      activeSessionId: 'session-1',
      sessions: [
        { id: 'session-1', personaId: 'default', title: 'Parent', createdAt: 1, updatedAt: 1 },
      ],
      messages: [],
      sessionMessages: { 'session-1': [] },
      agentTurns: [],
      sessionAgentTurns: { 'session-1': [] },
      activeTurnId: null,
      sessionActiveTurnIds: { 'session-1': null },
      pendingMessage: null,
    });

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
      hasActiveLoopForSession: () => true,
      fetchMessages: async () => [
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
      onContextInvalidated: vi.fn(),
    });

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

  it('does not replace a live follow-up workflow turn on reconnect when hydrated history still lacks that prompt run', async () => {
    useSessionStore.setState({
      activeSessionId: 'session-1',
      sessions: [
        { id: 'session-1', personaId: 'default', title: 'Parent', createdAt: 1, updatedAt: 4 },
      ],
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
      hasActiveLoopForSession: () => true,
      fetchMessages: async () => [
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
      onContextInvalidated: vi.fn(),
    });

    await waitFor(() => {
      expect(setMessages).toHaveBeenCalled();
    });
    expect(setAgentTurns).not.toHaveBeenCalled();
  });

  it('clears awaitingFirstChunk during reconnect recovery before replaying a live runtime snapshot', async () => {
    const setAwaitingFirstChunk = vi.fn();
    const setStreaming = vi.fn();

    useAgentStore.setState({
      runtimeActivitySnapshots: {
        'session-1': {
          sessionId: 'session-1',
          active: true,
          turnId: 'turn-live',
          queueLength: 0,
          pendingConfirmations: [],
          pendingBudgetApprovals: [],
          toolActivities: [],
          childExecutions: [],
          updatedAt: 200,
          run: {
            id: 'run-live',
            sessionId: 'session-1',
            turnId: 'turn-live',
            phase: 'llm_streaming',
            status: 'active',
            retryCount: 0,
            safeResume: true,
            startedAt: 100,
            updatedAt: 200,
            lastHeartbeatAt: 200,
          },
        },
      },
      sessionStatusSnapshots: {
        'session-1': {
          sessionId: 'session-1',
          active: false,
          turnId: 'turn-stale',
          queueLength: 0,
        },
      },
      bufferedSessionStatusSnapshots: {},
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
      setStreaming,
      setAwaitingFirstChunk,
      clearToolArgProgressTracking: vi.fn(),
      clearToolActivities: vi.fn(),
      removeActiveAgentLoop: vi.fn(),
      setPendingConfirmation: vi.fn(),
      getActiveSessionId: () => useSessionStore.getState().activeSessionId,
      getSessionMessages: (sessionId) => useSessionStore.getState().getSessionMessages(sessionId),
      setMessages: vi.fn((messages, sessionId?: string | null) => {
        useSessionStore.getState().setMessages(messages, sessionId);
      }),
      setAgentTurns: vi.fn((turns, sessionId?: string | null) => {
        useSessionStore.getState().setAgentTurns(turns, sessionId);
      }),
      hasActiveLoopForSession: () => false,
      fetchMessages: async () => [],
    });

    await waitFor(() => {
      expect(setAwaitingFirstChunk).toHaveBeenCalledWith(false);
    });
    expect(setStreaming).toHaveBeenCalledWith(false, undefined, 'session-1');
    expect(useSessionStore.getState().getSessionActiveTurnId('session-1')).toBe('turn-live');
  });
});
