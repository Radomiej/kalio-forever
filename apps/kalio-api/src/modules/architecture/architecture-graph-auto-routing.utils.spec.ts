import { describe, expect, it, vi } from 'vitest';
import type { ArchitectureExecutionEvent, ArchitectureRun, ArchitectureSchema, ArchitectureSchemaEdge } from '@kalio/types';
import { resolveSavedAutoRoute, runAutoRoutingVisit } from './architecture-graph-auto-routing.utils';

describe('resolveSavedAutoRoute', () => {
  const edges: ArchitectureSchemaEdge[] = [
    { id: 'choice-edge', fromNodeId: 'auto', toNodeId: 'agent', selection: 'choice' },
    { id: 'default-edge', fromNodeId: 'auto', toNodeId: 'default', selection: 'default' },
  ];

  it('reuses the exact persisted edge for the same visit without asking the chooser again', async () => {
    const chooser = vi.fn();
    const event = {
      id: 'run:event:4',
      runId: 'run',
      sequence: 4,
      type: 'router_decision',
      message: 'Auto-routing selected Builder.',
      nodeId: 'auto',
      route: { source: 'jev_choice', fromNodeId: 'auto', selectedNodeIds: ['agent'], nextNodeId: 'agent', selectedEdgeId: 'choice-edge', confidence: 0.93 },
      data: { autoRoutingVisit: 2, selectedEdgeId: 'choice-edge' },
      createdAt: 4,
    } satisfies ArchitectureExecutionEvent;

    expect(resolveSavedAutoRoute([event], 'auto', 2, edges)).toEqual(edges[0]);
    const persistAndEmit = vi.fn();
    const result = await runAutoRoutingVisit({
      schema: { nodes: [], edges } as unknown as ArchitectureSchema,
      node: { id: 'auto', kind: 'auto_router', label: 'Judge' },
      run: { id: 'run' } as ArchitectureRun,
      incomingNodeIds: [], incomingEvents: [event], outgoingEdges: edges,
      nodesById: new Map(), visit: 2, visitCounts: { auto: 2 },
      choose: chooser, persistAndEmit,
    });
    expect(result).toEqual(['agent']);
    expect(chooser).not.toHaveBeenCalled();
    expect(persistAndEmit).not.toHaveBeenCalled();
  });

  it('does not reuse a route from another visit and fails closed for a stale edge ID', () => {
    const event = {
      id: 'run:event:4',
      runId: 'run',
      sequence: 4,
      type: 'router_decision',
      message: 'Auto-routing selected Builder.',
      nodeId: 'auto',
      route: { source: 'jev_choice', fromNodeId: 'auto', selectedNodeIds: ['agent'], nextNodeId: 'agent', selectedEdgeId: 'deleted-edge' },
      data: { autoRoutingVisit: 1, selectedEdgeId: 'deleted-edge' },
      createdAt: 4,
    } satisfies ArchitectureExecutionEvent;

    expect(resolveSavedAutoRoute([event], 'auto', 2, edges)).toBeUndefined();
    expect(() => resolveSavedAutoRoute([event], 'auto', 1, edges)).toThrow('does not match the saved graph');
  });
});
