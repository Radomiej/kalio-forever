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

  it('normalizes branch session ids and marks in-progress architecture graphs as running', () => {
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
      },
    });

    const routeNode = model.nodes.find((node) => node.id === 'architecture-root:goal_master');

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
          branchSessionId: 'arch-run-42-goal_master',
          streamStatus: 'pending',
        }),
      }),
    });
    expect(routeNode?.detail).toContain('1 branch messages loaded');
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
