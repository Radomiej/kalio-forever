import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ArchitectureChatProjection,
  ArchitectureExecutionEvent,
  ArchitectureGraphProjection,
  ChatMessage,
  ChatSession,
} from '@kalio/types';
import { reloadSessionHistoryWithArchitectureProjection } from './architectureReloadHydration';
import { buildTurnsFromHistory } from './chatUtils';

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

const mockAgentState: {
  pendingBudgetApprovals: Record<string, Array<{
    requestId: string;
    sessionId: string;
    scope: string;
    usedIterations: number;
    currentLimit: number;
    suggestedNextLimit?: number;
    requestedBy?: string;
    nodeId?: string;
    roleSlotId?: string;
  }>>;
  setPendingBudgetApproval: (sessionId: string, request: {
    requestId: string;
    sessionId: string;
    scope: string;
    usedIterations: number;
    currentLimit: number;
    suggestedNextLimit?: number;
    requestedBy?: string;
    nodeId?: string;
    roleSlotId?: string;
  }) => void;
} = {
  pendingBudgetApprovals: {},
  setPendingBudgetApproval: (sessionId, request) => {
    const existing = mockAgentState.pendingBudgetApprovals[sessionId] ?? [];
    mockAgentState.pendingBudgetApprovals[sessionId] = [
      ...existing.filter((item) => item.requestId !== request.requestId),
      request,
    ];
  },
};

vi.mock('../../store/sessionStore', () => ({
  useSessionStore: Object.assign(() => mockState, {
    getState: () => mockState,
  }),
}));

vi.mock('../../store/agentStore', () => ({
  useAgentStore: Object.assign(() => mockAgentState, {
    getState: () => mockAgentState,
  }),
}));

describe('reloadSessionHistoryWithArchitectureProjection', () => {
  beforeEach(() => {
    mockState.activeSessionId = 'host';
    mockState.sessions = [];
    mockState.sessionMessages = {};
    mockAgentState.pendingBudgetApprovals = {};
  });

  it('keeps a rehydrated workflow envelope attached to its real user prompt after a follow-up prompt exists', async () => {
    mockState.sessions = [
      { id: 'host', personaId: 'default', title: 'Host', createdAt: 1, updatedAt: 1 },
    ];

    const fetchMessages = vi.fn(async () => [
      {
        id: 'user-1',
        sessionId: 'host',
        role: 'user' as const,
        content: 'Assess what this workflow can do.',
        createdAt: 10,
      },
      {
        id: 'architecture:run-1:text:event-finalizer',
        sessionId: 'host',
        role: 'assistant' as const,
        content: '',
        turnId: 'architecture-turn-run-1',
        promptMessageId: 'user-1',
        createdAt: 20,
        architectureRun: {
          runId: 'run-1',
          schemaId: 'strategic-decision-council',
          status: 'completed' as const,
          trace: [],
          routeHops: [],
          hostProjectionKind: 'workflow-envelope' as const,
          finalArtifact: 'Mock structured final artifact.',
        },
      },
      {
        id: 'user-2',
        sessionId: 'host',
        role: 'user' as const,
        content: 'Repeat the previous conclusion.',
        createdAt: 30,
      },
    ]);
    const fetchArchitectureRunProjection = vi.fn(async () => ({
      events: [],
      chat: { runId: 'run-1', messages: [] } satisfies ArchitectureChatProjection,
      graph: {
        runId: 'run-1',
        schemaId: 'strategic-decision-council',
        schemaName: 'Strategic Decision Council',
        status: 'completed' as const,
        nodes: [],
        edges: [],
        routeHops: [],
      } satisfies ArchitectureGraphProjection,
    }));

    const reloadedMessages = await reloadSessionHistoryWithArchitectureProjection({
      sessionId: 'host',
      getActiveSessionId: () => mockState.activeSessionId,
      getSessions: () => mockState.sessions,
      getSessionMessages: mockState.getSessionMessages,
      setMessages: vi.fn(),
      setAgentTurns: vi.fn(),
      fetchMessages,
      fetchArchitectureRunProjection,
    });
    if (!reloadedMessages) {
      throw new Error('Expected reloaded messages');
    }

    const summary = reloadedMessages.find((message) => message.id === 'architecture-rehydrate:host:run-1');
    expect(summary).toMatchObject({
      turnId: 'architecture-turn-run-1',
      promptMessageId: 'user-1',
    });
    const turns = buildTurnsFromHistory(reloadedMessages, 'host');
    expect(turns.find((turn) => turn.id === 'architecture-turn-run-1')?.promptMessageId).toBe('user-1');
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

  it('rehydrates a run_sub_agentflow workflow envelope from typed tool result metadata after reload', async () => {
    const hostMessages: ChatMessage[] = [
      {
        id: 'user-goal-guard',
        sessionId: 'host',
        role: 'user',
        content: 'Run Goal Guard from Talk.',
        createdAt: 10,
      },
      {
        id: 'assistant-agentflow-tool',
        sessionId: 'host',
        role: 'assistant',
        content: '',
        promptMessageId: 'user-goal-guard',
        createdAt: 11,
        toolCalls: [
          {
            id: 'call-agentflow',
            name: 'run_sub_agentflow',
            args: {
              flowId: 'goal_guard_delivery_loop',
              goal: 'Run Implementer and Goal Guard.',
            },
          },
        ],
      },
      {
        id: 'tool-agentflow-result',
        sessionId: 'host',
        role: 'tool_result',
        toolCallId: 'call-agentflow',
        content: JSON.stringify({
          flowRunId: 'flow-run-1',
          childSessionId: 'child-flow-1',
          status: 'done',
          summary: 'Goal Guard accepted typed evidence.',
          decisions: ['accepted'],
          nextActions: [],
          artifacts: ['qa/proof.md'],
          tracePreview: [],
          openChatSessionId: 'child-flow-1',
          openGraphRunId: 'run-subflow-1',
        }),
        createdAt: 12,
      },
    ];
    const fetchMessages = vi.fn(async () => hostMessages);
    const fetchArchitectureRunProjection = vi.fn(async () => {
      const chat: ArchitectureChatProjection = {
        runId: 'run-subflow-1',
        messages: [
          {
            id: 'chat-finalizer',
            eventId: 'event-finalizer',
            speaker: 'finalizer',
            content: 'Goal Guard accepted typed evidence.',
            roleSlotId: 'finalizer',
            createdAt: 20,
          },
        ],
      };
      const events: ArchitectureExecutionEvent[] = [
        {
          id: 'event-finalizer',
          runId: 'run-subflow-1',
          sequence: 1,
          type: 'node_completed' as ArchitectureExecutionEvent['type'],
          message: 'Finalizer completed with typed evidence.',
          nodeId: 'finalizer',
          roleSlotId: 'finalizer',
          createdAt: 20,
        },
      ];
      const graph: ArchitectureGraphProjection = {
        runId: 'run-subflow-1',
        schemaId: 'goal_guard_delivery_loop',
        schemaName: 'Goal Master Delivery Loop',
        status: 'completed',
        nodes: [
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

    expect(fetchArchitectureRunProjection).toHaveBeenCalledWith('run-subflow-1');
    expect(reloadedMessages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'architecture-rehydrate:host:run-subflow-1',
        promptMessageId: 'user-goal-guard',
        architectureRun: expect.objectContaining({
          runId: 'run-subflow-1',
          schemaId: 'Goal Master Delivery Loop',
          status: 'completed',
          hostProjectionKind: 'workflow-envelope',
        }),
      }),
    ]));
    const workflowTurns = buildTurnsFromHistory(reloadedMessages ?? [], 'host')
      .filter((turn) => turn.turnKind === 'workflow-envelope');
    expect(workflowTurns).toHaveLength(1);
    expect(workflowTurns[0]?.promptMessageId).toBe('user-goal-guard');
    expect(setMessages).toHaveBeenCalledWith(reloadedMessages, 'host');
  });

  it('keeps a run_sub_agentflow workflow envelope attached to the original user prompt when the tool call lacks promptMessageId', async () => {
    const hostMessages: ChatMessage[] = [
      {
        id: 'user-goal-guard',
        sessionId: 'host',
        role: 'user',
        content: 'Run Goal Guard from Talk.',
        createdAt: 10,
      },
      {
        id: 'assistant-agentflow-tool',
        sessionId: 'host',
        role: 'assistant',
        content: '',
        createdAt: 11,
        toolCalls: [
          {
            id: 'call-agentflow',
            name: 'run_sub_agentflow',
            args: {
              flowId: 'goal_guard_delivery_loop',
              goal: 'Run Implementer and Goal Guard.',
            },
          },
        ],
      },
      {
        id: 'tool-agentflow-result',
        sessionId: 'host',
        role: 'tool_result',
        toolCallId: 'call-agentflow',
        content: JSON.stringify({
          flowRunId: 'flow-run-1',
          childSessionId: 'child-flow-1',
          status: 'done',
          summary: 'Goal Guard accepted typed evidence.',
          decisions: ['accepted'],
          nextActions: [],
          artifacts: ['qa/proof.md'],
          tracePreview: [],
          openChatSessionId: 'child-flow-1',
          openGraphRunId: 'run-subflow-1',
        }),
        createdAt: 12,
      },
      {
        id: 'follow-up-user',
        sessionId: 'host',
        role: 'user',
        content: 'Repeat the conclusion.',
        createdAt: 13,
      },
    ];
    const fetchMessages = vi.fn(async () => hostMessages);
    const fetchArchitectureRunProjection = vi.fn(async () => ({
      chat: {
        runId: 'run-subflow-1',
        messages: [
          {
            id: 'chat-finalizer',
            eventId: 'event-finalizer',
            speaker: 'finalizer',
            content: 'Goal Guard accepted typed evidence.',
            roleSlotId: 'finalizer',
            createdAt: 20,
          },
        ],
      } satisfies ArchitectureChatProjection,
      events: [
        {
          id: 'event-finalizer',
          runId: 'run-subflow-1',
          sequence: 1,
          type: 'node_completed' as ArchitectureExecutionEvent['type'],
          message: 'Finalizer completed with typed evidence.',
          nodeId: 'finalizer',
          roleSlotId: 'finalizer',
          createdAt: 20,
        },
      ] satisfies ArchitectureExecutionEvent[],
      graph: {
        runId: 'run-subflow-1',
        schemaId: 'goal_guard_delivery_loop',
        schemaName: 'Goal Master Delivery Loop',
        status: 'completed',
        nodes: [
          {
            id: 'finalizer',
            label: 'Finalizer',
            kind: 'artifact',
            status: 'completed',
            eventIds: ['event-finalizer'],
          },
        ],
        edges: [],
      } satisfies ArchitectureGraphProjection,
    }));

    const reloadedMessages = await reloadSessionHistoryWithArchitectureProjection({
      sessionId: 'host',
      getActiveSessionId: () => mockState.activeSessionId,
      getSessionMessages: mockState.getSessionMessages,
      setMessages: vi.fn(),
      setAgentTurns: vi.fn(),
      fetchMessages,
      fetchArchitectureRunProjection,
    });

    const workflowTurn = buildTurnsFromHistory(reloadedMessages ?? [], 'host')
      .find((turn) => turn.turnKind === 'workflow-envelope');
    expect(workflowTurn?.promptMessageId).toBe('user-goal-guard');
    expect(workflowTurn?.promptMessageId).not.toBe('follow-up-user');
    expect(reloadedMessages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'architecture-rehydrate:host:run-subflow-1',
        promptMessageId: 'user-goal-guard',
      }),
    ]));
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

  it('keeps multiple workflow envelopes after host reload follow-ups', async () => {
    const hostMessages: ChatMessage[] = [
      {
        id: 'architecture:run-1:user',
        sessionId: 'host',
        role: 'user',
        content: '[Architecture: Strategic Decision Council]\nAssess the project.',
        createdAt: 10,
      },
      {
        id: 'architecture:run-1:text:final',
        sessionId: 'host',
        role: 'assistant',
        content: '',
        createdAt: 11,
        turnId: 'architecture-turn-run-1',
        promptMessageId: 'architecture:run-1:user',
        architectureRun: {
          runId: 'run-1',
          schemaId: 'strategic-decision-council',
          status: 'completed',
          hostProjectionKind: 'workflow-envelope',
          trace: [],
          routeHops: [],
          graphNodes: [],
        },
      },
      {
        id: 'architecture:run-2:user',
        sessionId: 'host',
        role: 'user',
        content: '[Architecture: Strategic Decision Council]\nAssess the project again.',
        createdAt: 20,
      },
      {
        id: 'architecture:run-2:text:final',
        sessionId: 'host',
        role: 'assistant',
        content: '',
        createdAt: 21,
        turnId: 'architecture-turn-run-2',
        promptMessageId: 'architecture:run-2:user',
        architectureRun: {
          runId: 'run-2',
          schemaId: 'strategic-decision-council',
          status: 'failed',
          hostProjectionKind: 'workflow-envelope',
          trace: [],
          routeHops: [],
          graphNodes: [],
        },
      },
    ];
    const fetchMessages = vi.fn(async () => hostMessages);
    const fetchArchitectureRunProjection = vi.fn(async (runId: string) => {
      const graph: ArchitectureGraphProjection = {
        runId,
        schemaId: 'strategic-decision-council',
        schemaName: 'Strategic Decision Council',
        status: runId === 'run-2' ? 'failed' : 'completed',
        nodes: [
          {
            id: `${runId}-router`,
            label: 'Router',
            kind: 'router',
            status: runId === 'run-2' ? 'failed' : 'completed',
            eventIds: [`${runId}-event-router`],
          },
        ],
        edges: [],
      };
      const events: ArchitectureExecutionEvent[] = [
        {
          id: `${runId}-event-router`,
          runId,
          sequence: 1,
          type: 'node_completed' as ArchitectureExecutionEvent['type'],
          message: runId === 'run-2' ? 'Router failed with typed status.' : 'Router completed.',
          nodeId: `${runId}-router`,
          roleSlotId: 'router',
          ...(runId === 'run-2' ? { status: 'failed' as const } : {}),
          createdAt: runId === 'run-2' ? 21 : 11,
        },
      ];
      const chat: ArchitectureChatProjection = {
        runId,
        messages: [],
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

    const workflowRunIds = (reloadedMessages ?? [])
      .map((message) => message.architectureRun?.runId)
      .filter((runId): runId is string => typeof runId === 'string');
    const workflowTurns = buildTurnsFromHistory(reloadedMessages ?? [], 'host')
      .filter((turn) => turn.turnKind === 'workflow-envelope');

    expect(fetchArchitectureRunProjection).toHaveBeenCalledWith('run-1');
    expect(fetchArchitectureRunProjection).toHaveBeenCalledWith('run-2');
    expect(workflowRunIds).toEqual(['run-1', 'run-2']);
    expect(workflowTurns).toHaveLength(2);
    expect(workflowTurns.map((turn) => turn.promptMessageId)).toEqual([
      'architecture:run-1:user',
      'architecture:run-2:user',
    ]);
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

  it('projects budget HITL requests from typed architecture events during child reload', async () => {
    const technicalSession: ChatSession = {
      id: 'arch-pragmatist',
      personaId: 'default',
      title: 'Strategic Decision Council: Pragmatist',
      parentSessionId: 'host',
      kind: 'subagent',
      runtimeContext: {
        runtimeKind: 'agent-flow-branch',
        architectureSlotId: 'pragmatist',
        architectureContext: {
          architectureRunId: 'run-budget',
          schemaName: 'Strategic Decision Council',
          displayLabel: 'Pragmatist',
          roleSlotId: 'pragmatist',
          roleSlotType: 'participant',
          sessionSurface: 'technical-node',
          conversationVisibility: 'visible',
        },
      },
      createdAt: 2,
      updatedAt: 2,
    };
    mockState.sessions = [technicalSession];
    mockState.activeSessionId = 'arch-pragmatist';

    const fetchMessages = vi.fn(async () => []);
    const fetchArchitectureRunProjection = vi.fn(async () => ({
      chat: {
        runId: 'run-budget',
        messages: [],
      } satisfies ArchitectureChatProjection,
      events: [
        {
          id: 'event-budget',
          runId: 'run-budget',
          sequence: 3,
          type: 'human_gate',
          message: 'Pragmatist requested more tool budget (1/1).',
          nodeId: 'pragmatist',
          roleSlotId: 'pragmatist',
          createdAt: 3,
          data: {
            kind: 'branch_stream',
            event: 'agent:budget_required',
            sessionId: 'arch-pragmatist',
            requestId: 'budget-1',
            usedIterations: 1,
            currentLimit: 1,
            suggestedNextLimit: 11,
            requestedBy: 'pragmatist',
          },
        },
      ] satisfies ArchitectureExecutionEvent[],
      graph: {
        runId: 'run-budget',
        schemaName: 'Strategic Decision Council',
        status: 'running',
        nodes: [
          {
            id: 'pragmatist',
            sessionId: 'arch-pragmatist',
            label: 'Pragmatist',
            kind: 'role',
            status: 'running',
            eventIds: ['event-budget'],
          },
        ],
        edges: [],
      } satisfies ArchitectureGraphProjection,
    }));

    await reloadSessionHistoryWithArchitectureProjection({
      sessionId: 'arch-pragmatist',
      getActiveSessionId: () => mockState.activeSessionId,
      getSessions: () => mockState.sessions,
      getSessionMessages: mockState.getSessionMessages,
      setMessages: vi.fn(),
      setAgentTurns: vi.fn(),
      fetchMessages,
      fetchArchitectureRunProjection,
    });

    expect(mockAgentState.pendingBudgetApprovals['arch-pragmatist']).toEqual([
      expect.objectContaining({
        requestId: 'budget-1',
        sessionId: 'arch-pragmatist',
        scope: 'agent-flow-branch',
        usedIterations: 1,
        currentLimit: 1,
        suggestedNextLimit: 11,
        requestedBy: 'pragmatist',
        nodeId: 'pragmatist',
        roleSlotId: 'pragmatist',
      }),
    ]);
  });

  it('falls back to top-level node metadata when budget HITL payload omits node identifiers', async () => {
    const technicalSession: ChatSession = {
      id: 'arch-pragmatist',
      personaId: 'default',
      title: 'Strategic Decision Council: Pragmatist',
      parentSessionId: 'host',
      kind: 'subagent',
      runtimeContext: {
        runtimeKind: 'agent-flow-branch',
        architectureSlotId: 'pragmatist',
        architectureContext: {
          architectureRunId: 'run-budget',
          schemaName: 'Strategic Decision Council',
          displayLabel: 'Pragmatist',
          roleSlotId: 'pragmatist',
          roleSlotType: 'participant',
          sessionSurface: 'technical-node',
          conversationVisibility: 'visible',
        },
      },
      createdAt: 2,
      updatedAt: 2,
    };
    mockState.sessions = [technicalSession];
    mockState.activeSessionId = 'arch-pragmatist';

    const fetchMessages = vi.fn(async () => []);
    const fetchArchitectureRunProjection = vi.fn(async () => ({
      chat: {
        runId: 'run-budget',
        messages: [],
      } satisfies ArchitectureChatProjection,
      events: [
        {
          id: 'event-budget-fallback',
          runId: 'run-budget',
          sequence: 4,
          type: 'human_gate',
          message: 'Pragmatist requested more tool budget (2/2).',
          nodeId: 'pragmatist-top-level',
          roleSlotId: 'pragmatist-slot-top-level',
          createdAt: 4,
          data: {
            kind: 'branch_stream',
            event: 'agent:budget_required',
            sessionId: 'arch-pragmatist',
            requestId: 'budget-top-level',
            usedIterations: 2,
            currentLimit: 2,
            suggestedNextLimit: 12,
            requestedBy: 'pragmatist',
          },
        },
      ] satisfies ArchitectureExecutionEvent[],
      graph: {
        runId: 'run-budget',
        schemaName: 'Strategic Decision Council',
        status: 'running',
        nodes: [
          {
            id: 'pragmatist',
            sessionId: 'arch-pragmatist',
            label: 'Pragmatist',
            kind: 'role',
            status: 'running',
            eventIds: ['event-budget-fallback'],
          },
        ],
        edges: [],
      } satisfies ArchitectureGraphProjection,
    }));

    await reloadSessionHistoryWithArchitectureProjection({
      sessionId: 'arch-pragmatist',
      getActiveSessionId: () => mockState.activeSessionId,
      getSessions: () => mockState.sessions,
      getSessionMessages: mockState.getSessionMessages,
      setMessages: vi.fn(),
      setAgentTurns: vi.fn(),
      fetchMessages,
      fetchArchitectureRunProjection,
    });

    expect(mockAgentState.pendingBudgetApprovals['arch-pragmatist']).toEqual([
      expect.objectContaining({
        requestId: 'budget-top-level',
        sessionId: 'arch-pragmatist',
        nodeId: 'pragmatist-top-level',
        roleSlotId: 'pragmatist-slot-top-level',
      }),
    ]);
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
