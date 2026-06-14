import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage, ChatSession } from '@kalio/types';
import { reloadSessionHistoryWithArchitectureProjection } from './architectureReloadHydration';

const mockState: {
  activeSessionId: string | null;
  sessions: ChatSession[];
  sessionMessages: Record<string, ChatMessage[]>;
  getSessionMessages: (sessionId: string) => ChatMessage[];
} = {
  activeSessionId: 'host',
  sessions: [],
  sessionMessages: {},
  getSessionMessages: (sessionId) => mockState.sessionMessages[sessionId] ?? [],
};

vi.mock('../../store/sessionStore', () => ({
  useSessionStore: Object.assign(() => mockState, {
    getState: () => mockState,
  }),
}));

describe('reloadSessionHistoryWithArchitectureProjection', () => {
  beforeEach(() => {
    mockState.activeSessionId = 'host';
    mockState.sessions = [];
    mockState.sessionMessages = {};
  });

  it('injects a synthetic workflow-envelope summary from raw host messages without fetching envelope transcripts', async () => {
    const hostSession: ChatSession = {
      id: 'host',
      personaId: 'default',
      title: 'Architecture host',
      createdAt: 1,
      updatedAt: 1,
    };
    const envelopeSession: ChatSession = {
      id: 'arch-root',
      personaId: 'default',
      title: 'Architecture: Assess this repository.',
      parentSessionId: 'host',
      kind: 'chat',
      runtimeContext: {
        runtimeKind: 'agent-flow-branch',
        architectureContext: {
          architectureRunId: 'run-1',
          schemaName: 'Strategic Decision Council',
          displayLabel: 'Strategic Decision Council',
        },
      },
      createdAt: 2,
      updatedAt: 2,
    };
    mockState.sessions = [hostSession, envelopeSession];

    const hostMessages: ChatMessage[] = [
      {
        id: 'user-message',
        sessionId: 'host',
        role: 'user',
        content: '[Architecture: Strategic Decision Council]\nAssess this repository.',
        createdAt: 10,
      },
      {
        id: 'assistant-tools',
        sessionId: 'host',
        role: 'assistant',
        content: '',
        createdAt: 11,
        toolCalls: [
          {
            id: 'architecture:run-1:event-pragmatist',
            name: 'run_subagent',
            args: {
              architectureRunId: 'run-1',
              schemaName: 'Strategic Decision Council',
              nodeId: 'pragmatist',
              childSessionId: 'arch-pragmatist',
            },
          },
        ],
      },
      {
        id: 'tool-pragmatist',
        sessionId: 'host',
        role: 'tool_result',
        content: JSON.stringify({
          result: 'Pragmatist branch answer',
          taskId: 'run-1:event-pragmatist',
          childSessionId: 'arch-pragmatist',
          parentSessionId: 'host',
          vfsMode: 'shared',
          vfsSessionId: 'host',
          copiedFiles: [],
          durationMs: 0,
        }),
        toolCallId: 'architecture:run-1:event-pragmatist',
        createdAt: 12,
      },
      {
        id: 'router-text',
        sessionId: 'host',
        role: 'assistant',
        content: '### Router\n\nRouter selected a final path.',
        createdAt: 13,
      },
      {
        id: 'finalizer-text',
        sessionId: 'host',
        role: 'assistant',
        content: '### Finalizer\n\nFinal answer.',
        createdAt: 14,
      },
    ];

    const fetchMessages = vi.fn(async (sessionId: string) => {
      if (sessionId === 'host') {
        return hostMessages;
      }
      return [];
    });
    const setMessages = vi.fn();
    const setAgentTurns = vi.fn();

    const reloadedMessages = await reloadSessionHistoryWithArchitectureProjection({
      sessionId: 'host',
      getActiveSessionId: () => mockState.activeSessionId,
      getSessionMessages: mockState.getSessionMessages,
      setMessages,
      setAgentTurns,
      fetchMessages,
    });

    expect(fetchMessages).toHaveBeenCalledTimes(1);
    expect(fetchMessages).toHaveBeenCalledWith('host');
    expect(reloadedMessages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'architecture-rehydrate:host:run-1',
        architectureRun: expect.objectContaining({
          runId: 'run-1',
          hostProjectionKind: 'workflow-envelope',
          status: 'completed',
        }),
      }),
    ]));
    expect(setMessages).toHaveBeenCalledWith(reloadedMessages, 'host');
    expect(setMessages).not.toHaveBeenCalledWith(expect.anything(), 'arch-root');
    expect(setAgentTurns).not.toHaveBeenCalledWith(expect.anything(), 'arch-root');
  });
});
