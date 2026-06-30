import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '@kalio/types';
import { renderArchitectureRunProjection } from './executionGraphArchitectureRun';
import type { ExecutionGraphEdge, ExecutionGraphNode } from './executionGraphModel.types';

function makeMessage(overrides: Partial<ChatMessage>): ChatMessage {
  return {
    id: 'msg-1',
    sessionId: 'session-1',
    role: 'assistant',
    content: '',
    createdAt: 1,
    ...overrides,
  } as ChatMessage;
}

describe('renderArchitectureRunProjection', () => {
  it('renders cancelled architecture runs as error nodes instead of success', () => {
    const nodes: ExecutionGraphNode[] = [];
    const edges: ExecutionGraphEdge[] = [];

    renderArchitectureRunProjection({
      addNode: (node) => {
        const stored = { ...node, x: 0, y: 0, width: 240, height: 120 };
        nodes.push(stored);
        return stored;
      },
      addEdge: (sourceId, targetId, style) => {
        edges.push({
          id: `${sourceId}->${targetId}:${style ?? 'solid'}`,
          sourceId,
          targetId,
          style: style ?? 'solid',
        });
      },
      architectureRun: null,
      branchMaxColumn: 1,
      finalMessage: makeMessage({
        id: 'final-1',
        architectureRun: {
          runId: 'run-cancelled',
          schemaId: 'goal-guard-delivery-loop',
          status: 'cancelled',
          trace: [
            {
              speaker: 'router',
              content: 'Stopped by user.',
              nodeId: 'goal-master',
              nextNodeId: 'implementer',
            },
          ],
          routeHops: [],
        },
      }),
      startRow: 0,
      turn: {
        id: 'turn-1',
        sessionId: 'session-1',
        promptMessageId: 'prompt-1',
        done: true,
        items: [],
      },
      turnNodeId: 'turn:turn-1',
    });

    expect(nodes[0]).toMatchObject({
      id: 'architecture-run:final-1',
      subtitle: 'goal-guard-delivery-loop / cancelled',
      status: 'error',
    });
    expect(edges).toContainEqual(
      expect.objectContaining({
        sourceId: 'turn:turn-1',
        targetId: 'architecture-run:final-1',
      }),
    );
  });

  it('renders running and failed route hops with non-success node status', () => {
    const nodes: ExecutionGraphNode[] = [];

    renderArchitectureRunProjection({
      addNode: (node) => {
        const stored = { ...node, x: 0, y: 0, width: 240, height: 120 };
        nodes.push(stored);
        return stored;
      },
      addEdge: () => undefined,
      architectureRun: null,
      branchMaxColumn: 1,
      finalMessage: makeMessage({
        id: 'final-running',
        architectureRun: {
          runId: 'run-running',
          schemaId: 'architecture-debate',
          status: 'running',
          trace: [
            {
              speaker: 'participant',
              content: 'Pragmatist is still streaming.',
              eventId: 'event-pragmatist',
              nodeId: 'pragmatist',
              nextNodeId: 'synthesizer',
              stream: {
                streamGroupId: 'group-1',
                branchSessionId: 'arch-run-running-pragmatist',
                status: 'streaming',
                chunkCount: 4,
                text: 'Pragmatist is still streaming.',
              },
            },
            {
              speaker: 'participant',
              content: 'Researcher failed.',
              eventId: 'event-researcher',
              nodeId: 'researcher',
              nextNodeId: 'synthesizer',
              stream: {
                streamGroupId: 'group-1',
                branchSessionId: 'arch-run-running-researcher',
                status: 'failed',
                chunkCount: 2,
                text: 'Researcher failed.',
              },
            },
          ],
          routeHops: [
            { eventId: 'event-pragmatist', source: 'parallel', fromNodeId: 'architecture-debate', toNodeId: 'pragmatist' },
            { eventId: 'event-researcher', source: 'parallel', fromNodeId: 'architecture-debate', toNodeId: 'researcher' },
          ],
        },
      }),
      startRow: 0,
      turn: {
        id: 'turn-1',
        sessionId: 'session-1',
        promptMessageId: 'prompt-1',
        done: false,
        items: [],
      },
      turnNodeId: 'turn:turn-1',
    });

    expect(nodes.find((node) => node.id === 'architecture-run:final-running')?.status).toBe('running');
    expect(nodes.find((node) => node.id === 'architecture-route:final-running:0')?.status).toBe('running');
    expect(nodes.find((node) => node.id === 'architecture-route:final-running:1')?.status).toBe('error');
  });

  it('uses typed trace status before run-level or stream fallback for route nodes', () => {
    const nodes: ExecutionGraphNode[] = [];

    renderArchitectureRunProjection({
      addNode: (node) => {
        const stored = { ...node, x: 0, y: 0, width: 240, height: 120 };
        nodes.push(stored);
        return stored;
      },
      addEdge: () => undefined,
      architectureRun: null,
      branchMaxColumn: 1,
      finalMessage: makeMessage({
        id: 'typed-route-status',
        architectureRun: {
          runId: 'run-typed-route-status',
          schemaId: 'goal-master-delivery-loop',
          status: 'running',
          trace: [
            {
              speaker: 'participant',
              content: 'Implementer finished its local work.',
              eventId: 'event-implementer-done',
              nodeId: 'implementer',
              nextNodeId: 'goal-master',
              status: 'done',
              stream: {
                streamGroupId: 'group-typed',
                branchSessionId: 'arch-run-typed-implementer',
                status: 'streaming',
                chunkCount: 3,
                text: 'Implementer finished its local work.',
              },
            },
            {
              speaker: 'participant',
              content: 'Verifier still needs orchestrator input.',
              eventId: 'event-verifier-waiting',
              nodeId: 'verifier',
              nextNodeId: 'goal-master',
              status: 'waiting_on_orchestrator',
              stream: {
                streamGroupId: 'group-typed',
                branchSessionId: 'arch-run-typed-verifier',
                status: 'completed',
                chunkCount: 2,
                text: 'Verifier still needs orchestrator input.',
              },
            },
          ],
          routeHops: [
            { eventId: 'event-implementer-done', source: 'parallel', fromNodeId: 'parallel', toNodeId: 'implementer' },
            { eventId: 'event-verifier-waiting', source: 'parallel', fromNodeId: 'parallel', toNodeId: 'verifier' },
          ],
        },
      }),
      startRow: 0,
      turn: {
        id: 'turn-1',
        sessionId: 'session-1',
        promptMessageId: 'prompt-1',
        done: false,
        items: [],
      },
      turnNodeId: 'turn:turn-1',
    });

    expect(nodes.find((node) => node.id === 'architecture-route:typed-route-status:0')?.status).toBe('success');
    expect(nodes.find((node) => node.id === 'architecture-route:typed-route-status:1')?.status).toBe('running');
  });

  it('uses stable workflow activity summaries for route node details', () => {
    const nodes: ExecutionGraphNode[] = [];

    renderArchitectureRunProjection({
      addNode: (node) => {
        const stored = { ...node, x: 0, y: 0, width: 240, height: 120 };
        nodes.push(stored);
        return stored;
      },
      addEdge: () => undefined,
      architectureRun: null,
      branchMaxColumn: 1,
      finalMessage: makeMessage({
        id: 'final-detail',
        architectureRun: {
          runId: 'run-detail',
          schemaId: 'architecture-debate',
          status: 'completed',
          trace: [
            {
              speaker: 'participant',
              content: '# Pragmatist\n\nReal branch output.',
              eventId: 'event-pragmatist',
              nodeId: 'pragmatist',
              nextNodeId: 'router',
              stream: {
                streamGroupId: 'group-2',
                branchSessionId: 'arch-run-detail-pragmatist',
                status: 'completed',
                chunkCount: 3,
                text: 'Real branch output.',
              },
            },
            {
              speaker: 'finalizer',
              content: '# Ocena Architektury Strategic Decision Council v0.1.0',
              eventId: 'event-finalizer',
              nodeId: 'finalizer',
              stream: {
                streamGroupId: 'group-2',
                branchSessionId: 'arch-run-detail-finalizer',
                status: 'completed',
                chunkCount: 5,
                text: 'Real finalizer output.',
              },
            },
          ],
          routeHops: [
            { eventId: 'event-pragmatist', source: 'parallel', fromNodeId: 'architecture-debate', toNodeId: 'pragmatist' },
            { eventId: 'event-finalizer', source: 'router', fromNodeId: 'router', toNodeId: 'finalizer' },
          ],
        },
      }),
      startRow: 0,
      turn: {
        id: 'turn-1',
        sessionId: 'session-1',
        promptMessageId: 'prompt-1',
        done: true,
        items: [],
      },
      turnNodeId: 'turn:turn-1',
    });

    expect(nodes.find((node) => node.id === 'architecture-route:final-detail:0')?.detail).toContain(
      'Branch completed its role-specific response.',
    );
    expect(nodes.find((node) => node.id === 'architecture-route:final-detail:1')?.detail).toContain(
      'Final answer produced from the routed graph outputs.',
    );
  });

  it('renders typed graph node labels instead of raw route ids', () => {
    const nodes: ExecutionGraphNode[] = [];

    renderArchitectureRunProjection({
      addNode: (node) => {
        const stored = { ...node, x: 0, y: 0, width: 240, height: 120 };
        nodes.push(stored);
        return stored;
      },
      addEdge: () => undefined,
      architectureRun: null,
      branchMaxColumn: 1,
      finalMessage: makeMessage({
        id: 'final-labels',
        architectureRun: {
          runId: 'run-labels',
          schemaId: 'strategic-decision-council',
          status: 'completed',
          trace: [
            {
              speaker: 'router',
              content: 'Route: router -> final-artifact',
              eventId: 'event-router',
              nodeId: 'router',
              nextNodeId: 'final-artifact',
            },
          ],
          routeHops: [
            { eventId: 'event-router', source: 'router', fromNodeId: 'router', toNodeId: 'final-artifact' },
          ],
          graphNodes: [
            { id: 'router', label: 'Router', kind: 'router', status: 'completed', eventIds: ['event-router'] },
            { id: 'final-artifact', label: 'Final Artifact', kind: 'artifact', status: 'completed', eventIds: [] },
          ],
        },
      }),
      startRow: 0,
      turn: {
        id: 'turn-1',
        sessionId: 'session-1',
        promptMessageId: 'prompt-1',
        done: true,
        items: [],
      },
      turnNodeId: 'turn:turn-1',
    });

    expect(nodes.find((node) => node.id === 'architecture-route:final-labels:0')).toMatchObject({
      title: 'Router',
      subtitle: 'Router -> Final Artifact',
    });
  });

  it('labels parallel fan-out routes with the target branch label', () => {
    const nodes: ExecutionGraphNode[] = [];

    renderArchitectureRunProjection({
      addNode: (node) => {
        const stored = { ...node, x: 0, y: 0, width: 240, height: 120 };
        nodes.push(stored);
        return stored;
      },
      addEdge: () => undefined,
      architectureRun: null,
      branchMaxColumn: 1,
      finalMessage: makeMessage({
        id: 'parallel-labels',
        architectureRun: {
          runId: 'run-parallel-labels',
          schemaId: 'strategic-decision-council',
          status: 'completed',
          trace: [
            {
              speaker: 'router',
              content: 'Parallel fan-out started.',
              eventId: 'event-parallel',
              nodeId: 'parallel-deliberation',
              nextNodeId: 'pragmatist',
              sessionId: 'arch-parallel-deliberation',
            },
          ],
          routeHops: [
            { eventId: 'event-parallel', source: 'parallel', fromNodeId: 'parallel-deliberation', toNodeId: 'pragmatist' },
          ],
          graphNodes: [
            { id: 'parallel-deliberation', label: 'Parallel Deliberation', kind: 'parallel', status: 'completed', eventIds: ['event-parallel'] },
            {
              id: 'pragmatist',
              sessionId: 'arch-pragmatist',
              label: 'Pragmatist',
              kind: 'role',
              status: 'completed',
              eventIds: [],
            },
          ],
        },
      }),
      startRow: 0,
      turn: {
        id: 'turn-1',
        sessionId: 'session-1',
        promptMessageId: 'prompt-1',
        done: true,
        items: [],
      },
      turnNodeId: 'turn:turn-1',
    });

    expect(nodes.find((node) => node.id === 'architecture-route:parallel-labels:0')).toMatchObject({
      title: 'Pragmatist',
      subtitle: 'Parallel Deliberation -> Pragmatist',
    });
    const fanOutNode = nodes.find((node) => node.id === 'architecture-route:parallel-labels:0');
    expect(fanOutNode?.sessionId).toBe('arch-pragmatist');
    expect(fanOutNode?.payload.kind === 'architecture-run' ? fanOutNode.payload.route?.branchSessionId : null).toBe(
      'arch-pragmatist',
    );
  });
});
