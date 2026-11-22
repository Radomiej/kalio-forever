import type { ArchitectureExecutionEvent, ArchitectureSchema, ArchitectureSchemaEdge, ArchitectureSchemaNode } from '@kalio/types';
import { hasValidStatusRoutingTopology } from './architecture-status-routing.schema';
import { isToolTimeoutRecovery } from './architecture-graph-topology.utils';

export function statusRoutingDecision(
  schema: ArchitectureSchema,
  node: ArchitectureSchemaNode,
  events: ArchitectureExecutionEvent[],
  runId: string,
) {
  if (node.kind !== 'status_router' || !node.statusRouting || !hasValidStatusRoutingTopology(schema.nodes, schema.edges)) {
    throw new Error('Invalid status condition configuration.');
  }
  const config = node.statusRouting;
  const sourceEvents = events.filter(event => event.runId === runId && event.nodeId === config.sourceNodeId);
  const start = [...sourceEvents].reverse().find(event => event.type === 'node_started');
  if (!start) throw new Error('Status condition requires a started source visit.');
  const visit = sourceEvents.filter(event => event.sequence > start.sequence);
  const terminals = visit.filter(event => event.type === 'node_completed' || event.type === 'node_failed'
    || isToolTimeoutRecovery(event));
  if (terminals.length !== 1) throw new Error('Status condition requires one terminal source outcome.');
  const terminal = terminals[0]!;
  const failed = terminal.type === 'node_failed' || isToolTimeoutRecovery(terminal)
    || visit.some(event => event.type === 'participant_output'
      && (event.data?.runtimeGuard === 'recoverable_node_error' || event.errorCode === 'SUBAGENT_TIMEOUT'));
  const observedStatus = failed ? 'failed' as const : 'completed' as const;
  const matched = observedStatus === config.expectedStatus;
  const edge = schema.edges.find(candidate => candidate.fromNodeId === node.id
    && candidate.selection === (matched ? 'choice' : 'default'));
  if (!edge) throw new Error('Status condition branch is unavailable.');
  return {
    edge,
    binding: {
      sourceNodeId: config.sourceNodeId,
      sourceStartedEventId: start.id,
      sourceTerminalEventId: terminal.id,
      expectedStatus: config.expectedStatus,
      observedStatus,
    },
    matched,
  };
}

export function assertSavedStatusRoutingDecision(
  schema: ArchitectureSchema,
  event: ArchitectureExecutionEvent,
  priorEvents: ArchitectureExecutionEvent[],
): ArchitectureSchemaEdge {
  const node = schema.nodes.find(candidate => candidate.id === event.nodeId);
  if (!node || node.kind !== 'status_router') throw new Error('Status checkpoint node is unavailable.');
  const decision = statusRoutingDecision(schema, node, priorEvents, event.runId);
  const saved = event.data?.statusRoutingDecision;
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)
    || Object.keys(saved).length !== Object.keys(decision.binding).length
    || Object.entries(decision.binding).some(([key, value]) => (saved as Record<string, unknown>)[key] !== value)
    || event.route?.source !== 'status_condition'
    || event.route.fromNodeId !== node.id
    || event.route.selectedEdgeId !== decision.edge.id || event.data?.selectedEdgeId !== decision.edge.id
    || event.route.nextNodeId !== decision.edge.toNodeId
    || event.route.selectedNodeIds.length !== 1 || event.route.selectedNodeIds[0] !== decision.edge.toNodeId) {
    throw new Error('Status checkpoint does not match the source visit or condition.');
  }
  return decision.edge;
}
