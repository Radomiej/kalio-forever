import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentFlowRunSnapshot, AgentFlowRunStatus, SubAgentFlowResult } from '@kalio/types';
import {
  getArchitectSessions,
  getGoalGuardAgentFlowRunResult,
  resumeGoalGuardAgentFlowRunWithQualityGate,
  saveArchitectureVariant,
  startArchitectureRun,
  startGoalGuardAgentFlowRun,
} from './architect.api';
import type { ArchitectSchema, ExternalQualityGateInput } from './architect.types';

const { apiGet, apiPost } = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
}));

function subAgentFlowResult(overrides: Partial<SubAgentFlowResult> = {}): SubAgentFlowResult {
  return {
    flowRunId: 'flow-run-result',
    childSessionId: 'child-session',
    status: 'running',
    summary: 'QA summary',
    decisions: [],
    nextActions: [],
    artifacts: [],
    ...overrides,
  };
}

vi.mock('../../services/apiClient', () => ({
  apiClient: {
    get: apiGet,
    post: apiPost,
  },
}));

describe('startArchitectureRun', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reads projections immediately after creating an async architecture run', async () => {
    apiPost.mockResolvedValueOnce({
      data: {
        id: 'run-1',
        schemaId: 'strategic-decision-council',
        prompt: 'Decide.',
        executionMode: 'subagent_execution',
        status: 'completed',
        createdAt: 1,
        updatedAt: 1,
      },
    });
    apiGet.mockImplementation((url: string) => {
      if (url === '/api/architecture-runs/run-1/events') {
        return Promise.resolve({ data: [{ id: 'event-1', type: 'participant_output' }] });
      }
      if (url === '/api/architecture-runs/run-1/graph') {
        return Promise.resolve({ data: { runId: 'run-1', nodes: [], edges: [] } });
      }
      if (url === '/api/architecture-runs/run-1/chat') {
        return Promise.resolve({ data: { runId: 'run-1', messages: [] } });
      }
      throw new Error(`Unexpected GET ${url}`);
    });

    const result = await startArchitectureRun(
      'strategic-decision-council',
      'Decide.',
      {},
      'subagent_execution',
    );

    expect(apiGet).not.toHaveBeenCalledWith('/api/architecture-runs/run-1');
    expect(result.run.status).toBe('completed');
    expect(result.events).toEqual([{ id: 'event-1', type: 'participant_output' }]);
  });

  it('polls running architecture runs and emits live projection updates', async () => {
    vi.useFakeTimers();
    apiPost.mockResolvedValueOnce({
      data: {
        id: 'run-1',
        schemaId: 'strategic-decision-council',
        prompt: 'Decide.',
        executionMode: 'subagent_execution',
        status: 'running',
        createdAt: 1,
        updatedAt: 1,
      },
    });
    apiGet.mockImplementation((url: string) => {
      if (url === '/api/architecture-runs/run-1/events') {
        return Promise.resolve({ data: [{ id: 'event-1', type: 'participant_output' }] });
      }
      if (url === '/api/architecture-runs/run-1/graph') {
        return Promise.resolve({ data: { runId: 'run-1', nodes: [], edges: [] } });
      }
      if (url === '/api/architecture-runs/run-1/chat') {
        return Promise.resolve({ data: { runId: 'run-1', messages: [] } });
      }
      if (url === '/api/architecture-runs/run-1') {
        return Promise.resolve({
          data: {
            id: 'run-1',
            schemaId: 'strategic-decision-council',
            prompt: 'Decide.',
            executionMode: 'subagent_execution',
            status: 'completed',
            createdAt: 1,
            updatedAt: 3,
            completedAt: 3,
          },
        });
      }
      throw new Error(`Unexpected GET ${url}`);
    });

    const onUpdate = vi.fn();
    const promise = startArchitectureRun(
      'strategic-decision-council',
      'Decide.',
      {},
      'subagent_execution',
      undefined,
      undefined,
      onUpdate,
    );
    await vi.advanceTimersByTimeAsync(2000);
    const result = await promise;

    expect(result.run.status).toBe('completed');
    expect(onUpdate).toHaveBeenCalledTimes(2);
    expect(onUpdate.mock.calls.map(([update]) => update.run.status)).toEqual(['running', 'completed']);
    vi.useRealTimers();
  });

  it('continues polling queued runs until a terminal failed status is returned', async () => {
    vi.useFakeTimers();
    apiPost.mockResolvedValueOnce({
      data: {
        id: 'run-queued',
        schemaId: 'strategic-decision-council',
        prompt: 'Decide.',
        executionMode: 'subagent_execution',
        status: 'queued',
        createdAt: 1,
        updatedAt: 1,
      },
    });
    let runStatusChecks = 0;
    apiGet.mockImplementation((url: string) => {
      if (url === '/api/architecture-runs/run-queued/events') {
        return Promise.resolve({ data: [{ id: 'event-1', type: 'participant_output' }] });
      }
      if (url === '/api/architecture-runs/run-queued/graph') {
        return Promise.resolve({ data: { runId: 'run-queued', nodes: [], edges: [] } });
      }
      if (url === '/api/architecture-runs/run-queued/chat') {
        return Promise.resolve({ data: { runId: 'run-queued', messages: [] } });
      }
      if (url === '/api/architecture-runs/run-queued') {
        runStatusChecks += 1;
        if (runStatusChecks === 1) {
          return Promise.resolve({
            data: {
              id: 'run-queued',
              schemaId: 'strategic-decision-council',
              prompt: 'Decide.',
              executionMode: 'subagent_execution',
              status: 'running',
              createdAt: 1,
              updatedAt: 2,
            },
          });
        }
        return Promise.resolve({
          data: {
            id: 'run-queued',
            schemaId: 'strategic-decision-council',
            prompt: 'Decide.',
            executionMode: 'subagent_execution',
            status: 'failed',
            createdAt: 1,
            updatedAt: 3,
            completedAt: 3,
          },
        });
      }
      throw new Error(`Unexpected GET ${url}`);
    });

    const onUpdate = vi.fn();
    const promise = startArchitectureRun(
      'strategic-decision-council',
      'Decide.',
      {},
      'subagent_execution',
      undefined,
      undefined,
      onUpdate,
    );

    await vi.advanceTimersByTimeAsync(4000);
    const result = await promise;

    expect(result.run.status).toBe('failed');
    expect(apiGet).toHaveBeenCalledWith('/api/architecture-runs/run-queued');
    expect(onUpdate.mock.calls.map(([update]) => update.run.status)).toEqual(['queued', 'running', 'failed']);
    vi.useRealTimers();
  });

  it('copies the schema payload before posting so nested graph edits cannot leak back into state', async () => {
    const schema: ArchitectSchema = {
      id: 'schema-1',
      name: 'Schema 1',
      description: 'Schema with a nested behavior config.',
      version: '1.0.0',
      roleSlots: [],
      nodes: [
        {
          id: 'node-1',
          label: 'Node 1',
          kind: 'role',
          roleSlotId: 'slot-1',
          behavior: {
            mode: 'rank_then_merge',
            fanOut: 'parallel',
            convergeToNodeId: 'node-2',
            maxBranches: 2,
            scoringPolicy: 'risk',
            description: 'Prefer the safer branch.',
          },
          x: 120,
          y: 90,
          slots: [],
          connections: ['node-2'],
        },
      ],
      edges: [
        {
          id: 'edge-1',
          fromNodeId: 'node-1',
          toNodeId: 'node-2',
          label: 'next',
        },
      ],
      routerPolicy: {
        mode: 'rank_then_merge',
        mustAddressCriticFindings: false,
        canReturnNeedsMoreResearch: false,
      },
      contextPolicy: {
        includeUserTask: true,
        includeProjectMemory: false,
        includeBrowserSession: false,
        includePriorDecisions: false,
      },
      memoryPolicy: {
        persistFinalArtifact: false,
        persistRouterDecision: false,
      },
      outputArtifactSchema: 'Artifact',
    };

    apiPost.mockResolvedValueOnce({
      data: {
        id: 'run-1',
        schemaId: 'schema-1',
        prompt: 'Decide.',
        executionMode: 'subagent_execution',
        status: 'completed',
        createdAt: 1,
        updatedAt: 1,
      },
    });
    apiGet.mockImplementation((url: string) => {
      if (url === '/api/architecture-runs/run-1/events') {
        return Promise.resolve({ data: [{ id: 'event-1', type: 'participant_output' }] });
      }
      if (url === '/api/architecture-runs/run-1/graph') {
        return Promise.resolve({ data: { runId: 'run-1', nodes: [], edges: [] } });
      }
      if (url === '/api/architecture-runs/run-1/chat') {
        return Promise.resolve({ data: { runId: 'run-1', messages: [] } });
      }
      throw new Error(`Unexpected GET ${url}`);
    });

    await startArchitectureRun('schema-1', 'Decide.', {}, 'subagent_execution', schema, { source: 'ui' });

    const posted = apiPost.mock.calls[0][1] as { schema?: ArchitectSchema };
    expect(posted.schema).toBeDefined();
    expect(posted.schema?.nodes[0]).not.toBe(schema.nodes[0]);
    expect(posted.schema?.nodes[0].behavior).not.toBe(schema.nodes[0].behavior);
    expect(posted.schema?.edges[0]).not.toBe(schema.edges[0]);
    expect(posted.schema).toMatchObject({
      id: 'schema-1',
      nodes: [
        {
          id: 'node-1',
          behavior: {
            mode: 'rank_then_merge',
            fanOut: 'parallel',
            convergeToNodeId: 'node-2',
            maxBranches: 2,
            scoringPolicy: 'risk',
            description: 'Prefer the safer branch.',
          },
        },
      ],
      edges: [
        {
          id: 'edge-1',
          fromNodeId: 'node-1',
          toNodeId: 'node-2',
          label: 'next',
        },
      ],
    });
  });
});

describe('getArchitectSessions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('surfaces parent-session AgentFlow conversations with linked open ids and newest visibility order', async () => {
    apiGet.mockImplementation((url: string) => {
      if (url === '/api/sessions') {
        return Promise.resolve({
          data: [
            {
              id: 'session-1',
              personaId: 'default',
              title: 'Main task',
              kind: 'chat',
              createdAt: 1,
              updatedAt: 5,
            },
          ],
        });
      }
      if (url === '/api/agent-flows/runs?parentSessionId=architect-ui') {
        return Promise.resolve({
          data: [
            {
              run: {
                id: 'flow-run-1',
                parentSessionId: 'architect-ui',
                childSessionId: 'flow-child-source',
                openChatSessionId: 'flow-linked-chat',
                openGraphRunId: 'flow-linked-graph',
                flowDefinitionId: 'goal_guard_delivery_loop',
                status: 'waiting_on_orchestrator',
                startMode: 'durable',
                returnMode: 'summary',
                createdAt: 2,
                updatedAt: 20,
              },
              result: {
                openChatSessionId: 'flow-linked-chat',
                openGraphRunId: 'flow-linked-graph',
              },
            },
          ],
        });
      }
      throw new Error(`Unexpected GET ${url}`);
    });

    const sessions = await getArchitectSessions();

    expect(sessions).toEqual([
      expect.objectContaining({
        id: 'flow-linked-chat',
        kind: 'agent-flow',
        parentSessionId: 'architect-ui',
        title: 'AgentFlow: goal_guard_delivery_loop (waiting_on_orchestrator)',
        updatedAt: 20,
      }),
      expect.objectContaining({
        id: 'session-1',
        title: 'Main task',
      }),
    ]);
  });

  it('deduplicates shared session ids and keeps newest sessions first across normal and AgentFlow sources', async () => {
    apiGet.mockImplementation((url: string) => {
      if (url === '/api/sessions') {
        return Promise.resolve({
          data: [
            {
              id: 'session-1',
              personaId: 'default',
              title: 'Main task',
              kind: 'chat',
              createdAt: 1,
              updatedAt: 5,
            },
            {
              id: 'session-2',
              personaId: 'default',
              title: 'Follow-up task',
              kind: 'chat',
              createdAt: 2,
              updatedAt: 30,
            },
          ],
        });
      }
      if (url === '/api/agent-flows/runs?parentSessionId=architect-ui') {
        return Promise.resolve({
          data: [
            {
              run: {
                id: 'flow-run-1',
                parentSessionId: 'architect-ui',
                childSessionId: 'session-1',
                openChatSessionId: 'session-1',
                openGraphRunId: 'flow-linked-graph',
                flowDefinitionId: 'goal_guard_delivery_loop',
                status: 'waiting_on_orchestrator',
                startMode: 'durable',
                returnMode: 'summary',
                createdAt: 3,
                updatedAt: 50,
              },
              result: {
                openChatSessionId: 'session-1',
                openGraphRunId: 'flow-linked-graph',
              },
            },
            {
              run: {
                id: 'flow-run-2',
                parentSessionId: 'architect-ui',
                childSessionId: 'flow-child-source',
                openChatSessionId: 'flow-linked-chat',
                openGraphRunId: 'flow-linked-graph-2',
                flowDefinitionId: 'goal_guard_delivery_loop',
                status: 'running',
                startMode: 'durable',
                returnMode: 'summary',
                createdAt: 4,
                updatedAt: 80,
              },
              result: {
                openChatSessionId: 'flow-linked-chat',
                openGraphRunId: 'flow-linked-graph-2',
              },
            },
          ],
        });
      }
      throw new Error(`Unexpected GET ${url}`);
    });

    const sessions = await getArchitectSessions();
    const ids = sessions.map((session) => session.id);

    expect(ids).toEqual(['flow-linked-chat', 'session-2', 'session-1']);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('saveArchitectureVariant', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws when the registry returns an empty variant payload', async () => {
    apiPost.mockResolvedValueOnce({ data: undefined });

    await expect(saveArchitectureVariant('schema-1', { name: 'Variant' })).rejects.toThrow(
      'Architecture variant response was empty',
    );
  });
});

describe('startGoalGuardAgentFlowRun', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    [{ maxArchitectureSteps: 7 }, 7],
    [{ maxArchitectureSteps: '7' }, undefined],
    [undefined, undefined],
  ])('includes maxSteps only when context has a numeric maxArchitectureSteps', async (
    context: Record<string, unknown> | undefined,
    expected: number | undefined,
  ) => {
    apiPost.mockResolvedValueOnce({
      data: {
        run: {
          id: 'agent-flow-1',
          parentSessionId: 'architect-ui',
          childSessionId: 'child-1',
          flowDefinitionId: 'goal_guard_delivery_loop',
          status: 'running',
          startMode: 'durable',
          returnMode: 'summary',
          createdAt: 1,
          updatedAt: 2,
        },
        events: [],
      } satisfies AgentFlowRunSnapshot,
    });
    apiGet.mockImplementation((url: string) => {
      if (url === '/api/architecture-runs/agent-flow-1/events') {
        return Promise.resolve({ data: [] });
      }
      if (url === '/api/architecture-runs/agent-flow-1/graph') {
        return Promise.resolve({ data: { runId: 'agent-flow-1', nodes: [], edges: [] } });
      }
      if (url === '/api/architecture-runs/agent-flow-1/chat') {
        return Promise.resolve({ data: { runId: 'agent-flow-1', messages: [] } });
      }
      throw new Error(`Unexpected GET ${url}`);
    });

    const result = await startGoalGuardAgentFlowRun('Build and verify.', context);

    expect(apiPost).toHaveBeenCalledWith('/api/agent-flows/runs', expect.objectContaining({
      flowId: 'goal_guard_delivery_loop',
      goal: 'Build and verify.',
      parentSessionId: 'architect-ui',
      startMode: 'durable',
      returnMode: 'summary',
      maxSteps: expected,
      context,
    }));
    expect(result.run.rootSessionId).toBe('child-1');
  });

  it('can use the active chat session as the AgentFlow parent', async () => {
    apiPost.mockResolvedValueOnce({
      data: {
        run: {
          id: 'agent-flow-chat',
          parentSessionId: 'chat-session-1',
          childSessionId: 'child-chat',
          flowDefinitionId: 'goal_guard_delivery_loop',
          status: 'running',
          startMode: 'durable',
          returnMode: 'summary',
          createdAt: 1,
          updatedAt: 2,
        },
        events: [],
      } satisfies AgentFlowRunSnapshot,
    });
    apiGet.mockRejectedValue(new Error('architecture projection unavailable'));

    await startGoalGuardAgentFlowRun('Build from Talk.', { requireImplementerWriteProof: true }, 'chat-session-1');

    expect(apiPost).toHaveBeenCalledWith('/api/agent-flows/runs', expect.objectContaining({
      parentSessionId: 'chat-session-1',
      context: { requireImplementerWriteProof: true },
    }));
  });
});

describe('getGoalGuardAgentFlowRunResult', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    ['done', 'completed'],
    ['failed', 'failed'],
    ['blocked', 'failed'],
    ['cancelled', 'failed'],
    ['queued', 'queued'],
    ['running', 'running'],
  ])('maps AgentFlow status "%s" to architecture status "%s"', async (agentFlowStatus, expected) => {
    apiGet.mockRejectedValue(new Error('architecture projection unavailable'));

    const snapshot: AgentFlowRunSnapshot = {
      run: {
        id: 'agent-flow-1',
        parentSessionId: 'architect-ui',
        childSessionId: 'child-1',
        flowDefinitionId: 'goal_guard_delivery_loop',
        status: agentFlowStatus as AgentFlowRunStatus,
        startMode: 'durable',
        returnMode: 'summary',
        openGraphRunId: 'graph-from-run',
        openChatSessionId: 'chat-from-run',
        createdAt: 1,
        updatedAt: 2,
        ...(agentFlowStatus === 'done' ? { finishedAt: 3 } : {}),
      },
      result: subAgentFlowResult({
        openGraphRunId: 'graph-from-result',
        openChatSessionId: 'chat-from-result',
        summary: 'QA summary',
        status: agentFlowStatus as AgentFlowRunStatus,
      }),
      events: [],
    };

    const result = await getGoalGuardAgentFlowRunResult(snapshot, 'Build and verify.');

    expect(result.run.status).toBe(expected);
    expect(result.agentFlowStatus).toBe(agentFlowStatus);
    expect(result.agentFlowSummary).toBe('QA summary');
    if (agentFlowStatus === 'done') {
      expect(result.run.completedAt).toBe(3);
    } else {
      expect(result.run.completedAt).toBeUndefined();
    }
  });

  it('falls back to AgentFlow projection when the architecture run is unavailable', async () => {
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    apiGet.mockImplementation((url: string) => {
      if (url === '/api/agent-flows/runs/flow-run-1') {
        return Promise.resolve({
          data: {
            run: {
              id: 'flow-run-1',
              parentSessionId: 'architect-ui',
              childSessionId: 'child-session',
              flowDefinitionId: 'goal_guard_delivery_loop',
              status: 'blocked',
              startMode: 'durable',
              returnMode: 'summary',
              createdAt: 10,
              updatedAt: 20,
            },
            result: subAgentFlowResult({
              flowRunId: 'flow-run-1',
              openGraphRunId: 'graph-from-result',
              openChatSessionId: 'chat-from-result',
              summary: 'Fallback summary',
              status: 'blocked',
            }),
            events: [
              {
                id: 'event-1',
                sequence: 1,
                type: 'architecture:router_decision',
                message: 'Route to worker.',
                nodeId: 'goal-master',
                roleSlotId: 'router',
                createdAt: 11,
              },
              {
                id: 'event-2',
                sequence: 2,
                type: 'architecture:node_completed',
                message: 'Worker finished.',
                nodeId: 'worker-1',
                roleSlotId: 'worker',
                createdAt: 12,
              },
              {
                id: 'event-3',
                sequence: 3,
                type: 'final_artifact',
                message: 'Ship it.',
                nodeId: 'worker-1',
                roleSlotId: 'finalizer',
                createdAt: 13,
              },
              {
                id: 'event-4',
                sequence: 4,
                type: 'participant_output',
                message: 'Still need review.',
                nodeId: 'reviewer-1',
                roleSlotId: 'reviewer',
                createdAt: 14,
              },
            ],
          } satisfies AgentFlowRunSnapshot,
        });
      }
      if (url.startsWith('/api/architecture-runs/')) {
        return Promise.reject(new Error('projection unavailable'));
      }
      throw new Error(`Unexpected GET ${url}`);
    });

    const result = await getGoalGuardAgentFlowRunResult('flow-run-1', 'Build and verify.');

    expect(result.run.id).toBe('graph-from-result');
    expect(result.run.rootSessionId).toBe('chat-from-result');
    expect(result.run.status).toBe('failed');
    expect(result.run.completedAt).toBeUndefined();
    expect(result.graph.nodes).toEqual([
      {
        id: 'goal-master',
        label: 'Goal Master',
        kind: 'router',
        status: 'pending',
        eventIds: ['event-1'],
      },
      {
        id: 'worker-1',
        label: 'Worker 1',
        kind: 'role',
        status: 'completed',
        eventIds: ['event-2', 'event-3'],
      },
      {
        id: 'reviewer-1',
        label: 'Reviewer 1',
        kind: 'role',
        status: 'pending',
        eventIds: ['event-4'],
      },
    ]);
    expect(result.chat.messages.map((message) => message.speaker)).toEqual([
      'router',
      'participant',
      'finalizer',
      'participant',
    ]);
    expect(result.agentFlowSummary).toBe('Fallback summary');
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      'Falling back to AgentFlow snapshot projection for Architect run result',
      expect.any(Error),
    );
    consoleWarnSpy.mockRestore();
  });
});

describe('resumeGoalGuardAgentFlowRunWithQualityGate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    [
      { source: '  ', status: 'passed', highFindings: 0, summary: '  QA passed  ', artifactPath: '  /tmp/report.md  ' },
      {
        source: 'playwright',
        summary: 'QA passed',
        artifacts: ['/tmp/report.md'],
      },
    ],
    [
      { source: '  review-bot  ', status: 'failed', highFindings: 2, summary: '  Needs follow-up  ', artifactPath: '   ' },
      {
        source: 'review-bot',
        summary: 'Needs follow-up',
      },
    ],
  ] satisfies Array<[ExternalQualityGateInput, { source: string; summary: string; artifacts?: string[] }]>)
    ('normalizes external QA evidence before resuming the AgentFlow', async (
    gate: ExternalQualityGateInput,
    expectedGate: { source: string; summary: string; artifacts?: string[] },
  ) => {
    apiPost.mockResolvedValueOnce({
      data: {
        run: {
          id: 'flow-run-2',
          parentSessionId: 'architect-ui',
          childSessionId: 'child-session',
          flowDefinitionId: 'goal_guard_delivery_loop',
          status: 'running',
          startMode: 'durable',
          returnMode: 'summary',
          createdAt: 10,
          updatedAt: 20,
        },
        result: subAgentFlowResult({
          flowRunId: 'flow-run-2',
          openGraphRunId: 'graph-from-result',
          openChatSessionId: 'chat-from-result',
          summary: 'Fallback summary',
        }),
        events: [],
      } satisfies AgentFlowRunSnapshot,
    });
    apiGet.mockImplementation((url: string) => {
      if (url.startsWith('/api/architecture-runs/')) {
        return Promise.reject(new Error('projection unavailable'));
      }
      throw new Error(`Unexpected GET ${url}`);
    });

    await resumeGoalGuardAgentFlowRunWithQualityGate('flow-run-1', 'Build and verify.', { feature: 'architect' }, gate, 13);

    const expectedQualityGate = {
      source: expectedGate.source,
      status: gate.status,
      highFindings: gate.highFindings,
      summary: expectedGate.summary,
      ...(expectedGate.artifacts ? { artifacts: expectedGate.artifacts } : {}),
    };
    const expectedInput = `Resume after external ${expectedQualityGate.source} QA evidence: ${expectedQualityGate.summary}`;

    expect(apiPost).toHaveBeenCalledWith('/api/agent-flows/runs/flow-run-1/resume', {
      input: expectedInput,
      context: {
        feature: 'architect',
        externalQualityGate: expectedQualityGate,
      },
      maxSteps: 13,
    });
  });
});
