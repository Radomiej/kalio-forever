import type { ArchitectureExecutionEvent, ArchitectureSchema } from '@kalio/types';
import { describe, expect, it } from 'vitest';
import { assignNextArchitectureEventSequence, mergeArchitectureRuntimeEvents, recoverAutoRoutingCursor } from './architecture-runtime-auto-routing-recovery.utils';

const schema: ArchitectureSchema = {
  id: 'recovery',
  name: 'Recovery',
  description: 'Checkpoint recovery fixture.',
  version: '1.0.0',
  roleSlots: [],
  nodes: [
    { id: 'auto', label: 'Auto-routing', kind: 'auto_router' },
    { id: 'agent', label: 'Agent', kind: 'artifact' },
    { id: 'after', label: 'After agent', kind: 'artifact' },
    { id: 'default', label: 'Default', kind: 'artifact' },
  ],
  edges: [
    { id: 'edge-agent', fromNodeId: 'auto', toNodeId: 'agent', selection: 'choice' },
    { id: 'edge-after', fromNodeId: 'agent', toNodeId: 'after' },
    { id: 'edge-default', fromNodeId: 'auto', toNodeId: 'default', selection: 'default' },
  ],
  routerPolicy: { mode: 'evidence_first', mustAddressCriticFindings: false, canReturnNeedsMoreResearch: false },
  contextPolicy: { includeUserTask: true, includeProjectMemory: false, includeBrowserSession: false, includePriorDecisions: false },
  memoryPolicy: { persistFinalArtifact: true, persistRouterDecision: true },
  outputArtifactSchema: 'markdown',
};

describe('Architecture Auto-routing recovery', () => {
  it('recovers the selected successor and visit number from a completed route history', () => {
    const events: ArchitectureExecutionEvent[] = [
      { id: 'run:event:1', runId: 'run', sequence: 1, type: 'run_created', message: 'Created.', createdAt: 1 },
      { id: 'run:event:2', runId: 'run', sequence: 2, type: 'node_started', nodeId: 'auto', message: 'Started.', createdAt: 2 },
      {
        id: 'run:event:3', runId: 'run', sequence: 3, type: 'router_decision', nodeId: 'auto', message: 'Selected agent.', createdAt: 3,
        route: { source: 'jev_choice', fromNodeId: 'auto', selectedNodeIds: ['agent'], nextNodeId: 'agent', selectedEdgeId: 'edge-agent' },
        data: { kind: 'auto_routing_decision', autoRoutingVisit: 1, selectedEdgeId: 'edge-agent', pendingNodeIds: ['agent'], visitCounts: { auto: 1 } },
      },
      { id: 'run:event:4', runId: 'run', sequence: 4, type: 'node_completed', nodeId: 'auto', message: 'Completed.', createdAt: 4 },
    ];

    expect(recoverAutoRoutingCursor(schema, events)).toEqual({
      reason: 'runtime_recovery',
      pendingNodeIds: ['agent'],
      visitCounts: { auto: 1 },
    });
  });

  it('recovers the flattened checkpoint shape written to durable audit storage', () => {
    const events: ArchitectureExecutionEvent[] = [{
      id: 'architecture-route:run:auto:1',
      runId: 'run',
      sequence: 3,
      type: 'router_decision',
      nodeId: 'auto',
      message: 'Selected agent.',
      route: { source: 'jev_choice', fromNodeId: 'auto', selectedNodeIds: ['agent'], nextNodeId: 'agent', selectedEdgeId: 'edge-agent' },
      data: {
        kind: 'architecture_event',
        eventType: 'router_decision',
        autoRoutingVisit: 1,
        selectedEdgeId: 'edge-agent',
        pendingNodeIds: ['agent'],
        visitCounts: { auto: 1 },
      },
      createdAt: 3,
    }];

    expect(recoverAutoRoutingCursor(schema, events)).toEqual({
      reason: 'runtime_recovery',
      pendingNodeIds: ['agent'],
      visitCounts: { auto: 1 },
    });
  });

  it('does not schedule a selected successor again after it completed', () => {
    const events: ArchitectureExecutionEvent[] = [
      {
        id: 'architecture-route:run:auto:1', runId: 'run', sequence: 3, type: 'router_decision', nodeId: 'auto', message: 'Selected agent.', createdAt: 3,
        route: { source: 'jev_choice', fromNodeId: 'auto', selectedNodeIds: ['agent'], nextNodeId: 'agent', selectedEdgeId: 'edge-agent' },
        data: { kind: 'architecture_event', eventType: 'router_decision', autoRoutingVisit: 1, selectedEdgeId: 'edge-agent', pendingNodeIds: ['agent'], visitCounts: { auto: 1 } },
      },
      { id: 'run:event:4', runId: 'run', sequence: 4, type: 'node_completed', nodeId: 'auto', message: 'Completed.', createdAt: 4 },
      { id: 'run:event:5', runId: 'run', sequence: 5, type: 'node_started', nodeId: 'agent', message: 'Started.', createdAt: 5 },
      { id: 'run:event:6', runId: 'run', sequence: 6, type: 'node_completed', nodeId: 'agent', message: 'Completed.', data: { selectedNodeIds: [] }, createdAt: 6 },
    ];

    expect(recoverAutoRoutingCursor(schema, events)?.pendingNodeIds).toEqual([]);
  });

  it('continues from a completed successor to its persisted next node', () => {
    const events: ArchitectureExecutionEvent[] = [
      {
        id: 'architecture-route:run:auto:1:event', runId: 'run', sequence: 3, type: 'router_decision', nodeId: 'auto', message: 'Selected agent.', createdAt: 3,
        route: { source: 'jev_choice', fromNodeId: 'auto', selectedNodeIds: ['agent'], nextNodeId: 'agent', selectedEdgeId: 'edge-agent' },
        data: { kind: 'architecture_event', eventType: 'router_decision', autoRoutingVisit: 1, selectedEdgeId: 'edge-agent', pendingNodeIds: ['agent'], visitCounts: { auto: 1 } },
      },
      { id: 'run:event:4', runId: 'run', sequence: 4, type: 'node_completed', nodeId: 'auto', message: 'Completed.', createdAt: 4 },
      { id: 'run:event:5', runId: 'run', sequence: 5, type: 'node_started', nodeId: 'agent', message: 'Started.', createdAt: 5 },
      { id: 'run:event:6', runId: 'run', sequence: 6, type: 'node_completed', nodeId: 'agent', message: 'Completed.', data: { selectedNodeIds: ['after'] }, createdAt: 6 },
    ];

    expect(recoverAutoRoutingCursor(schema, events)?.pendingNodeIds).toEqual(['after']);
  });

  it('resumes an auto-router interrupted before its route decision without restarting upstream nodes', () => {
    const events: ArchitectureExecutionEvent[] = [
      { id: 'run:event:1', runId: 'run', sequence: 1, type: 'node_completed', nodeId: 'upstream', message: 'Completed.', createdAt: 1 },
      { id: 'run:event:2', runId: 'run', sequence: 2, type: 'node_started', nodeId: 'auto', message: 'Started.', createdAt: 2 },
    ];

    expect(recoverAutoRoutingCursor(schema, events)).toMatchObject({
      reason: 'runtime_recovery',
      pendingNodeIds: ['auto'],
      resumeStartedNodeIds: ['auto'],
    });
  });

  it('retains a post-stop route checkpoint when live and persisted event streams are merged', () => {
    const stopEvent: ArchitectureExecutionEvent = {
      id: 'run:event:stop:stable', runId: 'run', sequence: 3, type: 'run_stopped', message: 'Stopped.', createdAt: 30,
    };
    const routeEvent: ArchitectureExecutionEvent = {
      id: 'run:event:4', runId: 'run', sequence: 4, type: 'router_decision', nodeId: 'auto', message: 'Selected default.', createdAt: 40,
      route: { source: 'runtime_fallback', fromNodeId: 'auto', selectedNodeIds: ['default'], nextNodeId: 'default', selectedEdgeId: 'edge-default' },
      data: { kind: 'auto_routing_decision', autoRoutingVisit: 1, selectedEdgeId: 'edge-default', pendingNodeIds: ['default'], visitCounts: { auto: 1 } },
    };

    const merged = mergeArchitectureRuntimeEvents([stopEvent], [routeEvent]);
    expect(merged.map((event) => event.type)).toEqual(['run_stopped', 'router_decision']);
    expect(new Set(merged.map((event) => event.id)).size).toBe(2);
    expect(recoverAutoRoutingCursor(schema, merged)?.pendingNodeIds).toEqual(['default']);
  });

  it('reserves distinct event sequences for concurrent stopped route checkpoints', () => {
    const first: ArchitectureExecutionEvent = {
      id: 'architecture-route:run:auto:1:event', runId: 'run', sequence: 2, type: 'router_decision', nodeId: 'auto', message: 'First route.', createdAt: 4,
      data: { autoRoutingVisit: 1 },
    };
    const second: ArchitectureExecutionEvent = {
      id: 'architecture-route:run:other:1:event', runId: 'run', sequence: 2, type: 'router_decision', nodeId: 'other', message: 'Second route.', createdAt: 4,
      data: { autoRoutingVisit: 1 },
    };
    const stoppedEvents: ArchitectureExecutionEvent[] = [
      { id: 'run:event:5', runId: 'run', sequence: 5, type: 'run_stopped', message: 'Stopped.', createdAt: 5 },
    ];

    const firstSequence = assignNextArchitectureEventSequence(first, stoppedEvents);
    const secondSequence = assignNextArchitectureEventSequence(second, stoppedEvents, firstSequence);

    expect(firstSequence).toBe(6);
    expect(secondSequence).toBe(7);
    expect(first.id).toBe('architecture-route:run:auto:1:event');
    expect(second.id).toBe('architecture-route:run:other:1:event');
  });

  it('rejects a checkpoint whose edge no longer matches the graph', () => {
    const event: ArchitectureExecutionEvent = {
      id: 'run:event:1', runId: 'run', sequence: 1, type: 'router_decision', nodeId: 'auto', message: 'Stale.', createdAt: 1,
      route: { source: 'jev_choice', fromNodeId: 'auto', selectedNodeIds: ['default'], nextNodeId: 'default', selectedEdgeId: 'missing' },
      data: { kind: 'auto_routing_decision', autoRoutingVisit: 1, selectedEdgeId: 'missing' },
    };
    expect(() => recoverAutoRoutingCursor(schema, [event])).toThrow('does not match the current graph');
  });
});
