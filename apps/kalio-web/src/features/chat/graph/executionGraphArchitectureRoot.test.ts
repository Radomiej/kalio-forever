import type { ArchitectureGraphProjection, ChatSession } from '@kalio/types';
import { describe, expect, it } from 'vitest';
import { architectureRunIdFromRootSession, buildArchitectureRootGraphModel } from './executionGraphArchitectureRoot';

describe('buildArchitectureRootGraphModel', () => {
  it('derives architecture run ids from root session ids only when the naming convention matches', () => {
    expect(architectureRunIdFromRootSession('arch-run-42-root')).toBe('run-42');
    expect(architectureRunIdFromRootSession('session-1')).toBeNull();
  });

  it('lays out routed architecture nodes left-to-right instead of stacking all roles vertically', () => {
    const graph: ArchitectureGraphProjection = {
      runId: 'run-30',
      nodes: [
        { id: 'orchestrator', label: 'Orchestrator', kind: 'role', status: 'completed', eventIds: [] },
        { id: 'implementer', label: 'Implementer', kind: 'role', status: 'completed', eventIds: [] },
        { id: 'materializer', label: 'Materializer', kind: 'role', status: 'completed', eventIds: [] },
        { id: 'verifier', label: 'Verifier', kind: 'role', status: 'completed', eventIds: [] },
        { id: 'tester', label: 'Tester', kind: 'role', status: 'completed', eventIds: [] },
        { id: 'goal-master', label: 'Goal Master', kind: 'router', status: 'completed', eventIds: [] },
        { id: 'final-artifact', label: 'Final Artifact', kind: 'artifact', status: 'completed', eventIds: [] },
      ],
      edges: [
        { id: 'orchestrator-implementer', fromNodeId: 'orchestrator', toNodeId: 'implementer' },
        { id: 'implementer-materializer', fromNodeId: 'implementer', toNodeId: 'materializer' },
        { id: 'materializer-verifier', fromNodeId: 'materializer', toNodeId: 'verifier' },
        { id: 'verifier-tester', fromNodeId: 'verifier', toNodeId: 'tester' },
        { id: 'tester-goal-master', fromNodeId: 'tester', toNodeId: 'goal-master' },
        { id: 'goal-master-final', fromNodeId: 'goal-master', toNodeId: 'final-artifact' },
        { id: 'goal-master-implementer', fromNodeId: 'goal-master', toNodeId: 'implementer' },
      ],
      routeHops: [
        { eventId: 'e1', source: 'agent', fromNodeId: 'orchestrator', toNodeId: 'implementer' },
        { eventId: 'e2', source: 'agent', fromNodeId: 'implementer', toNodeId: 'materializer' },
        { eventId: 'e3', source: 'agent', fromNodeId: 'materializer', toNodeId: 'verifier' },
        { eventId: 'e4', source: 'agent', fromNodeId: 'verifier', toNodeId: 'tester' },
        { eventId: 'e5', source: 'agent', fromNodeId: 'tester', toNodeId: 'goal-master' },
        { eventId: 'e6', source: 'router', fromNodeId: 'goal-master', toNodeId: 'implementer' },
        { eventId: 'e7', source: 'router', fromNodeId: 'goal-master', toNodeId: 'final-artifact' },
      ],
    };

    const model = buildArchitectureRootGraphModel({
      graph,
      rootSessionId: 'arch-run-30-root',
      sessions: [],
      sessionMessages: {},
    });

    const byId = new Map(model.nodes.map((node) => [node.id, node]));
    expect(byId.get('architecture-root:orchestrator')?.column).toBe(0);
    expect(byId.get('architecture-root:implementer')?.column).toBe(1);
    expect(byId.get('architecture-root:materializer')?.column).toBe(2);
    expect(byId.get('architecture-root:verifier')?.column).toBe(3);
    expect(byId.get('architecture-root:tester')?.column).toBe(4);
    expect(byId.get('architecture-root:goal-master')?.column).toBe(5);
    expect(byId.get('architecture-root:final-artifact')?.column).toBe(6);
    expect(new Set(model.nodes.map((node) => node.row))).toEqual(new Set([0]));
  });

  it('attaches branch sessions to every executable architecture node and marks in-progress graphs as running', () => {
    const graph = {
      runId: 'run-42',
      schemaId: 'strategic-decision-council',
      schemaName: 'Strategic Decision Council',
      nodes: [
        { id: 'goal_master', label: 'Goal Master', kind: 'router', status: 'pending', eventIds: ['event-1'] },
        { id: 'materializer', label: 'Materializer', kind: 'role', status: 'completed', eventIds: ['event-2'] },
      ],
      edges: [
        { id: 'goal-master-materializer', fromNodeId: 'goal_master', toNodeId: 'materializer' },
      ],
      routeHops: [
        { eventId: 'event-1', source: 'router', fromNodeId: 'goal_master', toNodeId: 'materializer' },
      ],
    } as ArchitectureGraphProjection & { schemaId?: string; schemaName?: string };

    const model = buildArchitectureRootGraphModel({
      graph,
      rootSessionId: 'arch-run-42-root',
      sessions: [
        {
          id: 'arch-run-42-goal_master',
          personaId: 'default',
          title: 'Goal Master branch',
          kind: 'subagent',
          parentSessionId: 'arch-run-42-root',
          createdAt: 1,
          updatedAt: 1,
        },
        {
          id: 'arch-run-42-materializer',
          personaId: 'default',
          title: 'Materializer branch',
          kind: 'subagent',
          parentSessionId: 'arch-run-42-root',
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      sessionMessages: {
        'arch-run-42-goal_master': [
          {
            id: 'branch-msg-1',
            sessionId: 'arch-run-42-goal_master',
            role: 'assistant',
            content: 'Branch still running.',
            createdAt: 1,
          } as never,
        ],
        'arch-run-42-materializer': [
          {
            id: 'branch-msg-2',
            sessionId: 'arch-run-42-materializer',
            role: 'assistant',
            content: 'Materializer completed its branch.',
            createdAt: 2,
          } as never,
        ],
      },
    });

    const routeNode = model.nodes.find((node) => node.id === 'architecture-root:goal_master');
    const roleNode = model.nodes.find((node) => node.id === 'architecture-root:materializer');

    expect(routeNode).toMatchObject({
      sessionId: 'arch-run-42-goal_master',
      subtitle: 'router / pending / branch session',
      status: 'idle',
      payload: expect.objectContaining({
        kind: 'architecture-run',
        summary: expect.objectContaining({
          schemaId: 'Strategic Decision Council',
          status: 'running',
        }),
        route: expect.objectContaining({
          branchSessionOpenable: true,
          branchSessionId: 'arch-run-42-goal_master',
          streamStatus: 'pending',
        }),
      }),
    });
    expect(routeNode?.detail).toContain('1 branch messages loaded');
    expect(roleNode).toMatchObject({
      sessionId: 'arch-run-42-materializer',
      subtitle: 'role / completed / branch session',
      status: 'success',
      payload: expect.objectContaining({
        route: expect.objectContaining({
          branchSessionOpenable: true,
          branchSessionId: 'arch-run-42-materializer',
          streamStatus: 'completed',
        }),
      }),
    });
    expect(roleNode?.detail).toContain('1 branch messages loaded');
  });

  it('maps final artifact nodes to the durable finalizer child session', () => {
    const graph: ArchitectureGraphProjection = {
      runId: 'run-final',
      nodes: [
        { id: 'router', label: 'Router', kind: 'router', status: 'completed', eventIds: ['event-router'] },
        { id: 'final-artifact', label: 'Final Artifact', kind: 'artifact', status: 'completed', eventIds: ['event-final'] },
      ],
      edges: [
        { id: 'router-final', fromNodeId: 'router', toNodeId: 'final-artifact' },
      ],
      routeHops: [
        { eventId: 'event-final', source: 'router', fromNodeId: 'router', toNodeId: 'final-artifact' },
      ],
    };

    const model = buildArchitectureRootGraphModel({
      graph,
      rootSessionId: 'arch-run-final-root',
      sessions: [
        {
          id: 'arch-run-final-finalizer',
          personaId: 'default',
          title: 'Strategic Decision Council: Finalizer',
          kind: 'subagent',
          parentSessionId: 'arch-run-final-root',
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      sessionMessages: {
        'arch-run-final-finalizer': [
          {
            id: 'finalizer-msg-1',
            sessionId: 'arch-run-final-finalizer',
            role: 'assistant',
            content: 'Final answer produced from the routed graph outputs.',
            createdAt: 1,
          } as never,
        ],
      },
    });

    const finalNode = model.nodes.find((node) => node.id === 'architecture-root:final-artifact');

    expect(finalNode).toMatchObject({
      sessionId: 'arch-run-final-finalizer',
      subtitle: 'artifact / completed / branch session',
      payload: expect.objectContaining({
        route: expect.objectContaining({
          branchSessionOpenable: true,
          branchSessionId: 'arch-run-final-finalizer',
        }),
      }),
    });
  });

  it('prefers durable API node session ids over session-name reconstruction', () => {
    const graph: ArchitectureGraphProjection = {
      runId: 'run-direct-session',
      nodes: [
        {
          id: 'pragmatist',
          sessionId: 'custom-pragmatist-session',
          label: 'Pragmatist',
          kind: 'role',
          status: 'completed',
          eventIds: ['event-pragmatist'],
        },
      ],
      edges: [],
      routeHops: [
        { eventId: 'event-pragmatist', source: 'runtime_fallback', fromNodeId: 'pragmatist', toNodeId: 'router' },
      ],
    };

    const model = buildArchitectureRootGraphModel({
      graph,
      rootSessionId: 'arch-run-direct-session-root',
      sessions: [
        {
          id: 'arch-run-direct-session-pragmatist',
          personaId: 'default',
          title: 'Legacy Pragmatist branch',
          kind: 'subagent',
          parentSessionId: 'arch-run-direct-session-root',
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      sessionMessages: {},
    });

    const roleNode = model.nodes.find((node) => node.id === 'architecture-root:pragmatist');

    expect(roleNode?.sessionId).toBe('custom-pragmatist-session');
    expect(roleNode?.payload.kind === 'architecture-run' ? roleNode.payload.route?.branchSessionId : null)
      .toBe('custom-pragmatist-session');
  });

  it('normalizes incomplete tool evidence before exposing it on the architecture root graph', () => {
    const graph: ArchitectureGraphProjection = {
      runId: 'run-43',
      nodes: [
        {
          id: 'goal-master',
          label: 'Goal Master',
          kind: 'router',
          status: 'completed',
          eventIds: ['event-1'],
          toolEvidence: {
            toolCallCount: '2',
            toolResultCount: 2,
            toolNames: ['vfs_write', 7, 'vfs_read'],
            successfulToolNames: ['vfs_write', 11],
          },
          incompleteReason: 'Needs a final response.',
        } as never,
        { id: 'implementer', label: 'Implementer', kind: 'role', status: 'completed', eventIds: ['event-2'] },
      ],
      edges: [
        { id: 'goal-master-implementer', fromNodeId: 'goal-master', toNodeId: 'implementer' },
      ],
      routeHops: [
        { eventId: 'event-1', source: 'router', fromNodeId: 'goal-master', toNodeId: 'implementer' },
      ],
    };

    const model = buildArchitectureRootGraphModel({
      graph,
      rootSessionId: 'arch-run-43-root',
      sessions: [],
      sessionMessages: {},
    });

    const routeNode = model.nodes.find((node) => node.id === 'architecture-root:goal-master');

    expect(routeNode?.payload.kind).toBe('architecture-run');
    expect(routeNode?.payload.kind === 'architecture-run' ? routeNode.payload.route?.toolEvidence : null).toEqual({
      toolCallCount: 0,
      toolResultCount: 2,
      toolNames: ['vfs_write', 'vfs_read'],
      successfulToolNames: ['vfs_write'],
    });
    expect(routeNode?.payload.kind === 'architecture-run' ? routeNode.payload.route?.incompleteReason : null).toBe('Needs a final response.');
  });

  it('stacks sibling architecture agents in the same stage', () => {
    const graph: ArchitectureGraphProjection = {
      runId: 'run-parallel',
      nodes: [
        { id: 'router', label: 'Router', kind: 'router', status: 'completed', eventIds: [] },
        { id: 'dev', label: 'Dev', kind: 'role', status: 'completed', eventIds: [] },
        { id: 'research', label: 'Research', kind: 'role', status: 'completed', eventIds: [] },
        { id: 'final', label: 'Final', kind: 'artifact', status: 'completed', eventIds: [] },
      ],
      edges: [
        { id: 'router-dev', fromNodeId: 'router', toNodeId: 'dev' },
        { id: 'router-research', fromNodeId: 'router', toNodeId: 'research' },
        { id: 'dev-final', fromNodeId: 'dev', toNodeId: 'final' },
        { id: 'research-final', fromNodeId: 'research', toNodeId: 'final' },
      ],
      routeHops: [],
    };

    const model = buildArchitectureRootGraphModel({
      graph,
      rootSessionId: 'arch-run-parallel-root',
      sessions: [],
      sessionMessages: {},
    });

    const dev = model.nodes.find((node) => node.id === 'architecture-root:dev');
    const research = model.nodes.find((node) => node.id === 'architecture-root:research');
    expect(dev?.column).toBe(research?.column);
    expect(new Set([dev?.row, research?.row])).toEqual(new Set([0, 1]));
  });

  it('uses terminal architecture run status instead of inferring running from pending nodes', () => {
    const graph: ArchitectureGraphProjection = {
      runId: 'run-1',
      status: 'failed',
      nodes: [
        {
          id: 'materializer',
          label: 'Materializer',
          kind: 'role',
          status: 'pending',
          eventIds: [],
        },
      ],
      edges: [],
      routeHops: [],
    };
    const sessions: ChatSession[] = [
      {
        id: 'arch-run-1-root',
        personaId: 'default',
        title: 'Goal Guard root',
        kind: 'agent-flow',
        createdAt: 1,
        updatedAt: 2,
      },
    ];

    const model = buildArchitectureRootGraphModel({
      graph,
      rootSessionId: 'arch-run-1-root',
      sessions,
      sessionMessages: {},
    });

    expect(model.nodes[0]?.status).toBe('error');
    expect(model.nodes[0]?.payload.kind).toBe('architecture-run');
    if (model.nodes[0]?.payload.kind === 'architecture-run') {
      expect(model.nodes[0].payload.summary.status).toBe('failed');
    }
  });

  it('renders cancelled architecture runs as terminal errors instead of success', () => {
    const graph: ArchitectureGraphProjection = {
      runId: 'run-cancelled',
      status: 'cancelled',
      nodes: [
        {
          id: 'materializer',
          label: 'Materializer',
          kind: 'role',
          status: 'pending',
          eventIds: [],
        },
      ],
      edges: [],
      routeHops: [],
    };

    const model = buildArchitectureRootGraphModel({
      graph,
      rootSessionId: 'arch-run-cancelled-root',
      sessions: [],
      sessionMessages: {},
    });

    expect(model.nodes[0]?.status).toBe('error');
    expect(model.nodes[0]?.payload.kind).toBe('architecture-run');
    if (model.nodes[0]?.payload.kind === 'architecture-run') {
      expect(model.nodes[0].payload.summary.status).toBe('cancelled');
    }
  });
});
