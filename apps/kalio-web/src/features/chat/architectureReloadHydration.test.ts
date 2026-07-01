import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ArchitectureChatProjection,
  ArchitectureExecutionEvent,
  ArchitectureGraphProjection,
  ChatMessage,
  ChatSession,
} from '@kalio/types';
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

  it('hydrates a workflow-envelope summary from typed projection when raw host messages only identify the run', async () => {
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
    const fetchArchitectureRunProjection = vi.fn(async () => {
      const chat: ArchitectureChatProjection = {
        runId: 'run-1',
        messages: [
          {
            id: 'chat-router',
            eventId: 'event-router',
            speaker: 'router',
            content: '### Router\n\nTyped router output.',
            roleSlotId: 'router',
            createdAt: 13,
          },
          {
            id: 'chat-finalizer',
            eventId: 'event-finalizer',
            speaker: 'finalizer',
            content: '### Finalizer\n\nTyped final answer.',
            roleSlotId: 'finalizer',
            createdAt: 14,
          },
        ],
      };
      const events: ArchitectureExecutionEvent[] = [
        {
          id: 'event-router',
          runId: 'run-1',
          sequence: 1,
          type: 'node_completed' as ArchitectureExecutionEvent['type'],
          message: 'Router completed synthesis for the next graph node.',
          nodeId: 'router',
          roleSlotId: 'router',
          createdAt: 13,
        },
        {
          id: 'event-finalizer',
          runId: 'run-1',
          sequence: 2,
          type: 'node_completed' as ArchitectureExecutionEvent['type'],
          message: 'Finalizer completed with typed evidence.',
          nodeId: 'finalizer',
          roleSlotId: 'finalizer',
          createdAt: 14,
        },
      ];
      const graph: ArchitectureGraphProjection = {
        runId: 'run-1',
        schemaId: 'strategic-decision-council',
        schemaName: 'Strategic Decision Council',
        status: 'completed',
        nodes: [
          {
            id: 'router',
            label: 'Router',
            kind: 'router',
            status: 'completed',
            eventIds: ['event-router'],
          },
          {
            id: 'finalizer',
            label: 'Finalizer',
            kind: 'artifact',
            status: 'completed',
            eventIds: ['event-finalizer'],
          },
        ],
        edges: [],
      };
      return { chat, events, graph };
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
      fetchArchitectureRunProjection,
    });

    expect(fetchMessages).toHaveBeenCalledTimes(1);
    expect(fetchMessages).toHaveBeenCalledWith('host');
    expect(fetchArchitectureRunProjection).toHaveBeenCalledWith('run-1');
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

  it('replaces stale architecture metadata with typed projection during workflow host reload', async () => {
    const staleHostMessages: ChatMessage[] = [
      {
        id: 'host-user',
        sessionId: 'host',
        role: 'user',
        content: 'Run architecture workflow.',
        createdAt: 10,
      },
      {
        id: 'stale-architecture-summary',
        sessionId: 'host',
        role: 'assistant',
        content: '',
        createdAt: 11,
        architectureRun: {
          runId: 'run-stale',
          schemaId: 'Architecture Debate',
          status: 'completed',
          trace: [],
          routeHops: [],
        },
      },
    ];
    const fetchMessages = vi.fn(async () => staleHostMessages);
    const fetchArchitectureRunProjection = vi.fn(async () => {
      const chat: ArchitectureChatProjection = {
        runId: 'run-stale',
        messages: [],
      };
      const events: ArchitectureExecutionEvent[] = [
        {
          id: 'event-router-failed',
          runId: 'run-stale',
          sequence: 6,
          type: 'router_decision' as ArchitectureExecutionEvent['type'],
          status: 'failed',
          nodeId: 'orchestrator',
          roleSlotId: 'orchestrator',
          errorCode: 'CONTRACT_VIOLATION',
          message: 'Typed structured output contract failure.',
          createdAt: 12,
        },
      ];
      const graph: ArchitectureGraphProjection = {
        runId: 'run-stale',
        schemaId: 'architecture_debate',
        schemaName: 'Architecture Debate',
        status: 'failed',
        nodes: [
          {
            id: 'orchestrator',
            sessionId: 'arch-run-stale-orchestrator',
            roleSlotId: 'orchestrator',
            label: 'Orchestrator',
            kind: 'router',
            status: 'failed',
            eventIds: ['event-router-failed'],
          },
          {
            id: 'finalizer',
            sessionId: 'arch-run-stale-finalizer',
            roleSlotId: 'finalizer',
            label: 'Finalizer',
            kind: 'artifact',
            status: 'pending',
            eventIds: [],
          },
        ],
        edges: [],
      };
      return { chat, events, graph };
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
      fetchArchitectureRunProjection,
    });

    expect(fetchArchitectureRunProjection).toHaveBeenCalledWith('run-stale');
    expect(reloadedMessages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'architecture-rehydrate:host:run-stale',
        architectureRun: expect.objectContaining({
          runId: 'run-stale',
          hostProjectionKind: 'workflow-envelope',
          status: 'failed',
          graphNodes: expect.arrayContaining([
            expect.objectContaining({ id: 'orchestrator', status: 'failed' }),
            expect.objectContaining({ id: 'finalizer', status: 'pending' }),
          ]),
        }),
      }),
    ]));
    expect(setMessages).toHaveBeenCalledWith(reloadedMessages, 'host');
  });

  it('hydrates a technical architecture child with synthetic node activity when the child has no persisted transcript yet', async () => {
    const technicalSession: ChatSession = {
      id: 'arch-router',
      personaId: 'default',
      title: 'Strategic Decision Council: Router',
      parentSessionId: 'host',
      kind: 'subagent',
      runtimeContext: {
        runtimeKind: 'agent-flow-branch',
        architectureSlotId: 'router',
        architectureContext: {
          architectureRunId: 'run-router',
          schemaName: 'Strategic Decision Council',
          displayLabel: 'Router',
          roleSlotId: 'router',
          roleSlotType: 'router',
          sessionSurface: 'technical-node',
          conversationVisibility: 'visible',
        },
      },
      createdAt: 2,
      updatedAt: 2,
    };
    mockState.sessions = [technicalSession];
    mockState.activeSessionId = 'arch-router';

    const setMessages = vi.fn();
    const setAgentTurns = vi.fn();
    const fetchMessages = vi.fn(async () => []);
    const fetchArchitectureRunProjection = vi.fn(async () => {
      const chat: ArchitectureChatProjection = {
        runId: 'run-router',
        messages: [],
      };
      const events: ArchitectureExecutionEvent[] = [
        {
          id: 'event-router',
          runId: 'run-router',
          sequence: 4,
          type: 'node_completed' as ArchitectureExecutionEvent['type'],
          message: 'Router completed synthesis for the next graph node.',
          nodeId: 'router-entry',
          roleSlotId: 'router',
          createdAt: 25,
        },
      ];
      const graph: ArchitectureGraphProjection = {
        runId: 'run-router',
        schemaName: 'Strategic Decision Council',
        status: 'running',
        nodes: [
          {
            id: 'router-entry',
            sessionId: 'arch-router',
            label: 'Router',
            kind: 'router',
            status: 'running',
            eventIds: ['event-router'],
          },
        ],
        edges: [],
      };
      return { chat, events, graph };
    });

    const reloadedMessages = await reloadSessionHistoryWithArchitectureProjection({
      sessionId: 'arch-router',
      getActiveSessionId: () => mockState.activeSessionId,
      getSessions: () => mockState.sessions,
      getSessionMessages: mockState.getSessionMessages,
      setMessages,
      setAgentTurns,
      fetchMessages,
      fetchArchitectureRunProjection,
    });

    expect(fetchMessages).toHaveBeenCalledWith('arch-router');
    expect(fetchArchitectureRunProjection).toHaveBeenCalledWith('run-router');
    expect(reloadedMessages).toEqual([
      expect.objectContaining({
        id: 'architecture-node-rehydrate:arch-router:run-router:event-router',
        sessionId: 'arch-router',
        role: 'assistant',
        content: expect.stringContaining('### Router'),
      }),
    ]);
    expect(reloadedMessages?.[0]?.content).toContain('Status: running');
    expect(reloadedMessages?.[0]?.content).toContain('Last action: Router completed synthesis for the next graph node.');
    expect(setMessages).toHaveBeenCalledWith(reloadedMessages, 'arch-router');
  });

  it('falls back to typed node activity when architecture chat content is malformed after reload', async () => {
    const technicalSession: ChatSession = {
      id: 'arch-router',
      personaId: 'default',
      title: 'Strategic Decision Council: Router',
      parentSessionId: 'host',
      kind: 'subagent',
      runtimeContext: {
        runtimeKind: 'agent-flow-branch',
        architectureSlotId: 'router',
        architectureContext: {
          architectureRunId: 'run-router',
          schemaName: 'Strategic Decision Council',
          displayLabel: 'Router',
          roleSlotId: 'router',
          roleSlotType: 'router',
          sessionSurface: 'technical-node',
          conversationVisibility: 'visible',
        },
      },
      createdAt: 2,
      updatedAt: 2,
    };
    mockState.sessions = [technicalSession];
    mockState.activeSessionId = 'arch-router';

    const setMessages = vi.fn();
    const setAgentTurns = vi.fn();
    const fetchMessages = vi.fn(async () => []);
    const fetchArchitectureRunProjection = vi.fn(async () => {
      const chat: ArchitectureChatProjection = {
        runId: 'run-router',
        messages: [
          {
            id: 'chat-router',
            eventId: 'event-router',
            speaker: 'router',
            content: { text: 'bad runtime payload' } as unknown as string,
            roleSlotId: 'router',
            createdAt: 25,
          },
        ],
      };
      const events: ArchitectureExecutionEvent[] = [
        {
          id: 'event-router',
          runId: 'run-router',
          sequence: 4,
          type: 'node_completed' as ArchitectureExecutionEvent['type'],
          message: 'Router completed synthesis for the next graph node.',
          nodeId: 'router-entry',
          roleSlotId: 'router',
          createdAt: 25,
        },
      ];
      const graph: ArchitectureGraphProjection = {
        runId: 'run-router',
        schemaName: 'Strategic Decision Council',
        status: 'running',
        nodes: [
          {
            id: 'router-entry',
            sessionId: 'arch-router',
            label: 'Router',
            kind: 'router',
            status: 'running',
            eventIds: ['event-router'],
          },
        ],
        edges: [],
      };
      return { chat, events, graph };
    });

    const reloadedMessages = await reloadSessionHistoryWithArchitectureProjection({
      sessionId: 'arch-router',
      getActiveSessionId: () => mockState.activeSessionId,
      getSessions: () => mockState.sessions,
      getSessionMessages: mockState.getSessionMessages,
      setMessages,
      setAgentTurns,
      fetchMessages,
      fetchArchitectureRunProjection,
    });

    expect(reloadedMessages?.[0]?.content).toContain('### Router');
    expect(reloadedMessages?.[0]?.content).toContain('Status: running');
    expect(reloadedMessages?.[0]?.content).toContain('Last action: Router completed synthesis for the next graph node.');
  });

  it('rehydrates the host workflow envelope from architecture run projection when host and child transcripts are still empty', async () => {
    const hostSession: ChatSession = {
      id: 'host',
      personaId: 'default',
      title: 'Architecture host',
      createdAt: 1,
      updatedAt: 1,
    };
    const routerSession: ChatSession = {
      id: 'arch-router',
      personaId: 'default',
      title: 'Strategic Decision Council: Router',
      parentSessionId: 'host',
      kind: 'subagent',
      runtimeContext: {
        runtimeKind: 'agent-flow-branch',
        architectureSlotId: 'router',
        architectureContext: {
          architectureRunId: 'run-host',
          schemaId: 'strategic-decision-council',
          schemaName: 'Strategic Decision Council',
          displayLabel: 'Router',
          roleSlotId: 'router',
          roleSlotType: 'router',
          sessionSurface: 'technical-node',
          conversationVisibility: 'visible',
        },
      },
      createdAt: 2,
      updatedAt: 2,
    };
    mockState.sessions = [hostSession, routerSession];
    mockState.activeSessionId = 'host';

    const setMessages = vi.fn();
    const setAgentTurns = vi.fn();
    const fetchMessages = vi.fn(async () => []);
    const fetchArchitectureRunProjection = vi.fn(async () => {
      const chat: ArchitectureChatProjection = {
        runId: 'run-host',
        messages: [
          {
            id: 'chat-router',
            eventId: 'event-router',
            speaker: 'router',
            content: '### Router\n\nRouter selected the five-way council.',
            roleSlotId: 'router',
            createdAt: 10,
          },
          {
            id: 'chat-finalizer',
            eventId: 'event-finalizer',
            speaker: 'finalizer',
            content: '### Finalizer\n\nFinal answer.',
            roleSlotId: 'finalizer',
            createdAt: 12,
          },
        ],
      };
      const events: ArchitectureExecutionEvent[] = [
        {
          id: 'event-router',
          runId: 'run-host',
          sequence: 1,
          type: 'node_completed' as ArchitectureExecutionEvent['type'],
          message: 'Router dispatched the council.',
          nodeId: 'router-entry',
          roleSlotId: 'router',
          createdAt: 10,
        },
        {
          id: 'event-finalizer',
          runId: 'run-host',
          sequence: 2,
          type: 'node_completed' as ArchitectureExecutionEvent['type'],
          message: 'Finalizer produced the recommendation.',
          nodeId: 'final-artifact',
          roleSlotId: 'finalizer',
          createdAt: 12,
        },
      ];
      const graph: ArchitectureGraphProjection = {
        runId: 'run-host',
        schemaId: 'strategic-decision-council',
        schemaName: 'Strategic Decision Council',
        status: 'completed',
        nodes: [
          {
            id: 'router-entry',
            sessionId: 'arch-router',
            label: 'Router',
            kind: 'router',
            status: 'completed',
            eventIds: ['event-router'],
          },
          {
            id: 'final-artifact',
            sessionId: 'arch-finalizer',
            label: 'Finalizer',
            kind: 'artifact',
            status: 'completed',
            eventIds: ['event-finalizer'],
          },
        ],
        edges: [],
      };
      return { chat, events, graph };
    });

    const reloadedMessages = await reloadSessionHistoryWithArchitectureProjection({
      sessionId: 'host',
      getActiveSessionId: () => mockState.activeSessionId,
      getSessions: () => mockState.sessions,
      getSessionMessages: mockState.getSessionMessages,
      setMessages,
      setAgentTurns,
      fetchMessages,
      fetchArchitectureRunProjection,
    });

    expect(fetchArchitectureRunProjection).toHaveBeenCalledWith('run-host');
    expect(reloadedMessages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'architecture-rehydrate:host:run-host',
        architectureRun: expect.objectContaining({
          runId: 'run-host',
          status: 'completed',
          hostProjectionKind: 'workflow-envelope',
        }),
      }),
    ]));
    expect(setMessages).toHaveBeenCalledWith(reloadedMessages, 'host');
  });

  it('keeps reconnect history hydration when typed architecture projection fetch fails', async () => {
    const setMessages = vi.fn();
    const setAgentTurns = vi.fn();
    mockState.sessions = [
      { id: 'host', personaId: 'default', title: 'Host', createdAt: 1, updatedAt: 1 },
    ];

    const fetchMessages = vi.fn(async () => [
      {
        id: 'user-1',
        sessionId: 'host',
        role: 'user' as const,
        content: 'Assess this repository.',
        createdAt: 1,
      },
      {
        id: 'assistant-tools',
        sessionId: 'host',
        role: 'assistant' as const,
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
            },
          },
        ],
      },
    ]);
    const fetchArchitectureRunProjection = vi.fn(async () => {
      throw new Error('projection unavailable');
    });

    const reloadedMessages = await reloadSessionHistoryWithArchitectureProjection({
      sessionId: 'host',
      getActiveSessionId: () => mockState.activeSessionId,
      getSessions: () => mockState.sessions,
      getSessionMessages: mockState.getSessionMessages,
      setMessages,
      setAgentTurns,
      fetchMessages,
      fetchArchitectureRunProjection,
    });

    expect(fetchArchitectureRunProjection).toHaveBeenCalledWith('run-live');
    expect(reloadedMessages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'architecture-rehydrate:host:run-live',
        architectureRun: expect.objectContaining({
          runId: 'run-live',
          schemaId: 'Strategic Decision Council',
          hostProjectionKind: 'workflow-envelope',
        }),
      }),
    ]));
    expect(setMessages).toHaveBeenCalledWith(reloadedMessages, 'host');
  });
});
