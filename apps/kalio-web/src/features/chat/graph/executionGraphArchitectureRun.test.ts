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
});
