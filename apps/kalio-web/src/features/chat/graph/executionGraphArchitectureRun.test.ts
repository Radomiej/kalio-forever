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
});
