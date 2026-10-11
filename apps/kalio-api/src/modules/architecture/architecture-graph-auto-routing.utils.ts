import type {
  ArchitectureExecutionEvent,
  ArchitectureRouteDecision,
  ArchitectureSchemaEdge,
  ArchitectureSchemaNode,
} from '@kalio/types';
import type { ArchitectureSchema, ArchitectureRun } from '@kalio/types';
import type {
  ArchitectureAutoRoutingChoice,
  ArchitectureAutoRoutingInput,
} from './architecture-auto-routing.service';

export type ResolvedAutoRoute = {
  edge: ArchitectureSchemaEdge;
  reused: boolean;
  route?: ArchitectureRouteDecision;
  message?: string;
  data?: Record<string, unknown>;
};

export function resolveSavedAutoRoute(
  events: ArchitectureExecutionEvent[],
  nodeId: string,
  visit: number,
  outgoingEdges: ArchitectureSchemaEdge[],
): ArchitectureSchemaEdge | undefined {
  const saved = [...events].reverse().find((event) => event.type === 'router_decision'
    && event.nodeId === nodeId
    && event.data?.['autoRoutingVisit'] === visit);
  if (!saved) return undefined;

  const edgeId = typeof saved.data?.['selectedEdgeId'] === 'string'
    ? saved.data['selectedEdgeId']
    : saved.route?.selectedEdgeId;
  const edge = outgoingEdges.find((candidate) => candidate.id === edgeId);
  if (!edge || !saved.route || saved.route.selectedEdgeId !== edge.id || saved.route.nextNodeId !== edge.toNodeId) {
    throw new Error(`Auto-routing checkpoint for ${nodeId} visit ${visit} does not match the saved graph.`);
  }
  return edge;
}

export function autoRouteDecisionProjection(input: {
  node: ArchitectureSchemaNode;
  edge: ArchitectureSchemaEdge;
  outgoingEdges: ArchitectureSchemaEdge[];
  visit: number;
  visitCounts: Record<string, number>;
  choice: ArchitectureAutoRoutingChoice;
  targetLabel: string;
}): { route: ArchitectureRouteDecision; message: string; data: Record<string, unknown> } {
  const selectedNodeIds = [input.edge.toNodeId];
  const route: ArchitectureRouteDecision = {
    source: input.choice.source,
    fromNodeId: input.node.id,
    selectedNodeIds,
    rejectedNodeIds: Array.from(new Set(input.outgoingEdges
      .filter((edge) => edge.id !== input.edge.id)
      .map((edge) => edge.toNodeId))),
    nextNodeId: input.edge.toNodeId,
    selectedEdgeId: input.edge.id,
    ...(input.choice.confidence !== undefined ? { confidence: input.choice.confidence } : {}),
    decisionReason: input.choice.reason,
  };
  const message = input.choice.source === 'jev_choice'
    ? `${input.node.label} selected ${input.targetLabel} with ${input.choice.confidence?.toFixed(2)} confidence.`
    : `${input.node.label} used its default route to ${input.targetLabel} (${input.choice.reason}).`;
  return {
    route,
    message,
    data: {
      kind: 'auto_routing_decision',
      autoRoutingVisit: input.visit,
      selectedEdgeId: input.edge.id,
      selectedNodeIds,
      pendingNodeIds: selectedNodeIds,
      visitCounts: input.visitCounts,
      outgoingEdgeIds: input.outgoingEdges.map((edge) => edge.id),
      decisionReason: input.choice.reason,
      ...(input.choice.confidence !== undefined ? { confidence: input.choice.confidence } : {}),
    },
  };
}

export async function runAutoRoutingVisit(input: {
  schema: ArchitectureSchema;
  node: ArchitectureSchemaNode;
  run: ArchitectureRun;
  incomingNodeIds: string[];
  incomingEvents: ArchitectureExecutionEvent[];
  outgoingEdges: ArchitectureSchemaEdge[];
  nodesById: Map<string, ArchitectureSchemaNode>;
  visit: number;
  visitCounts: Record<string, number>;
  choose?: (choiceInput: ArchitectureAutoRoutingInput) => Promise<ArchitectureAutoRoutingChoice>;
  persistAndEmit: (projection: ReturnType<typeof autoRouteDecisionProjection>, checkpointId: string) => Promise<void>;
}): Promise<string[]> {
  const savedEdge = resolveSavedAutoRoute(input.incomingEvents, input.node.id, input.visit, input.outgoingEdges);
  if (savedEdge) return [savedEdge.toNodeId];

  const defaultEdges = input.outgoingEdges.filter((edge) => edge.selection === 'default');
  const choiceEdges = input.outgoingEdges.filter((edge) => edge.selection === 'choice');
  if (defaultEdges.length !== 1 || choiceEdges.length === 0) {
    throw new Error(`Auto-routing node ${input.node.id} requires choice edges and exactly one default edge.`);
  }
  const defaultEdge = defaultEdges[0];
  if (!defaultEdge) throw new Error(`Auto-routing node ${input.node.id} has no default edge.`);

  const choice = input.choose
    ? await input.choose({
      schema: input.schema,
      node: input.node,
      run: input.run,
      incomingNodeIds: input.incomingNodeIds,
      incomingEvents: input.incomingEvents,
      outgoingEdges: input.outgoingEdges,
    })
    : { edgeId: defaultEdge.id, source: 'runtime_fallback' as const, reason: 'provider_error' as const };
  const edge = choice.source === 'jev_choice'
    ? choiceEdges.find((candidate) => candidate.id === choice.edgeId)
    : defaultEdge;
  const selectedEdge = edge ?? defaultEdge;
  const selectedChoice = edge
    ? choice
    : { edgeId: defaultEdge.id, source: 'runtime_fallback' as const, reason: 'invalid_response' as const };
  const targetLabel = input.nodesById.get(selectedEdge.toNodeId)?.label ?? selectedEdge.toNodeId;
  const projection = autoRouteDecisionProjection({
    node: input.node,
    edge: selectedEdge,
    outgoingEdges: input.outgoingEdges,
    visit: input.visit,
    visitCounts: input.visitCounts,
    choice: selectedChoice,
    targetLabel,
  });
  const checkpointId = architectureAutoRouteCheckpointId(input.run.id, input.node.id, input.visit);
  await input.persistAndEmit(projection, checkpointId);
  return [selectedEdge.toNodeId];
}

export async function executeAutoRoutingGraphNode(input: {
  schema: ArchitectureSchema;
  node: ArchitectureSchemaNode;
  run: ArchitectureRun;
  incomingNodeIds: string[];
  incomingEvents: ArchitectureExecutionEvent[];
  outgoingEdges: ArchitectureSchemaEdge[];
  nodesById: Map<string, ArchitectureSchemaNode>;
  visit: number;
  visitCounts: Record<string, number>;
  choose?: (choiceInput: ArchitectureAutoRoutingInput) => Promise<ArchitectureAutoRoutingChoice>;
  createDecisionEvent: (projection: ReturnType<typeof autoRouteDecisionProjection>) => ArchitectureExecutionEvent;
  persistDecision?: (event: ArchitectureExecutionEvent, checkpointId: string) => Promise<void>;
  appendEvent: (event: ArchitectureExecutionEvent) => void;
}): Promise<string[]> {
  return runAutoRoutingVisit({
    schema: input.schema,
    node: input.node,
    run: input.run,
    incomingNodeIds: input.incomingNodeIds,
    incomingEvents: input.incomingEvents,
    outgoingEdges: input.outgoingEdges,
    nodesById: input.nodesById,
    visit: input.visit,
    visitCounts: input.visitCounts,
    choose: input.choose,
    persistAndEmit: async (projection, checkpointId) => {
      if (!input.persistDecision) {
        throw new Error('Durable route decision storage is unavailable.');
      }
      const event = input.createDecisionEvent(projection);
      event.id = `${checkpointId}:event`;
      await input.persistDecision(event, checkpointId);
      input.appendEvent(event);
    },
  });
}

export function architectureAutoRouteCheckpointId(runId: string, nodeId: string, visit: number): string {
  return `architecture-route:${encodeURIComponent(runId)}:${encodeURIComponent(nodeId)}:${visit}`;
}
