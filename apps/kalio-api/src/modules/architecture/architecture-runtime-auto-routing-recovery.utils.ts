import type { AgentFlowContinuationCursor, ArchitectureExecutionEvent, ArchitectureSchema } from '@kalio/types';

export type ArchitectureRuntimeResumeCursor = AgentFlowContinuationCursor | {
  reason: 'runtime_recovery';
  pendingNodeIds: string[];
  visitCounts: Record<string, number>;
  resumeStartedNodeIds?: string[];
  waitingNodeId?: string;
  lastCompletedNodeId?: string;
  waitIdentity?: AgentFlowContinuationCursor['waitIdentity'];
};

export function mergeArchitectureRuntimeEvents(
  liveEvents: ArchitectureExecutionEvent[],
  persistedEvents: ArchitectureExecutionEvent[],
): ArchitectureExecutionEvent[] {
  const eventsById = new Map<string, ArchitectureExecutionEvent>();
  for (const event of persistedEvents) eventsById.set(event.id, event);
  for (const event of liveEvents) eventsById.set(event.id, event);
  return Array.from(eventsById.values()).sort((left, right) => (
    left.sequence - right.sequence
    || left.createdAt - right.createdAt
    || left.id.localeCompare(right.id)
  ));
}

export function recoverAutoRoutingCursor(
  schema: ArchitectureSchema,
  events: ArchitectureExecutionEvent[],
): ArchitectureRuntimeResumeCursor | undefined {
  const visitCounts: Record<string, number> = {};
  for (const event of events) {
    if (event.type === 'node_completed' && event.nodeId) {
      visitCounts[event.nodeId] = (visitCounts[event.nodeId] ?? 0) + 1;
    }
  }

  const checkpointIndexes = events.flatMap((event, index) => isAutoRoutingCheckpoint(event) ? [index] : []);
  const pendingNodeIds = new Set<string>();
  for (const checkpointIndex of checkpointIndexes) {
    const checkpoint = events[checkpointIndex];
    if (!checkpoint?.nodeId) continue;
    const selectedEdgeId = typeof checkpoint.data?.['selectedEdgeId'] === 'string'
      ? checkpoint.data['selectedEdgeId']
      : checkpoint.route?.selectedEdgeId;
    const edge = schema.edges.find((candidate) => candidate.id === selectedEdgeId
      && candidate.fromNodeId === checkpoint.nodeId
      && (!checkpoint.route?.nextNodeId || candidate.toNodeId === checkpoint.route.nextNodeId));
    if (!edge || !schema.nodes.some((node) => node.id === edge.toNodeId)) {
      throw new Error(`Saved Auto-routing checkpoint for ${checkpoint.nodeId} does not match the current graph.`);
    }

    const savedVisit = checkpoint.data?.['autoRoutingVisit'];
    visitCounts[checkpoint.nodeId] = Math.max(visitCounts[checkpoint.nodeId] ?? 0, savedVisit as number);
    const savedCounts = checkpoint.data?.['visitCounts'];
    if (isNumberRecord(savedCounts)) {
      for (const [nodeId, count] of Object.entries(savedCounts)) {
        visitCounts[nodeId] = Math.max(visitCounts[nodeId] ?? 0, count);
      }
    }

    const savedPending = checkpoint.data?.['pendingNodeIds'];
    const successors = Array.isArray(savedPending) && savedPending.every((nodeId) => typeof nodeId === 'string')
      ? savedPending.filter((nodeId): nodeId is string => typeof nodeId === 'string' && schema.nodes.some((node) => node.id === nodeId))
      : [edge.toNodeId];
    for (const nodeId of successors) {
      recoverPendingSuccessor(schema, events, checkpointIndex, nodeId, pendingNodeIds, new Set());
    }
  }

  const resumeStartedNodeIds: string[] = [];
  for (const node of schema.nodes.filter((candidate) => candidate.kind === 'auto_router')) {
    const startedIndex = lastEventIndex(events, node.id, 'node_started');
    if (startedIndex < 0) continue;
    const completedIndex = lastEventIndex(events, node.id, 'node_completed');
    const decisionIndex = checkpointIndexes.reduce((latest, index) => (
      events[index]?.nodeId === node.id ? Math.max(latest, index) : latest
    ), -1);
    if (startedIndex > Math.max(completedIndex, decisionIndex)) {
      pendingNodeIds.add(node.id);
      resumeStartedNodeIds.push(node.id);
    }
  }

  if (checkpointIndexes.length === 0 && pendingNodeIds.size === 0) return undefined;
  return {
    reason: 'runtime_recovery',
    pendingNodeIds: Array.from(pendingNodeIds),
    visitCounts,
    ...(resumeStartedNodeIds.length > 0 ? { resumeStartedNodeIds } : {}),
  };
}

function isAutoRoutingCheckpoint(event: ArchitectureExecutionEvent): boolean {
  return event.type === 'router_decision'
    && typeof event.data?.['autoRoutingVisit'] === 'number';
}

function recoverPendingSuccessor(
  schema: ArchitectureSchema,
  events: ArchitectureExecutionEvent[],
  afterIndex: number,
  nodeId: string,
  pendingNodeIds: Set<string>,
  visited: Set<string>,
): void {
  const visitKey = `${nodeId}:${afterIndex}`;
  if (visited.has(visitKey)) return;
  visited.add(visitKey);

  const startedIndex = lastEventIndex(events, nodeId, 'node_started', afterIndex);
  const completedIndex = lastEventIndex(events, nodeId, 'node_completed', afterIndex);
  if (completedIndex < 0 || startedIndex > completedIndex) {
    pendingNodeIds.add(nodeId);
    return;
  }

  const completed = events[completedIndex];
  if (!completed) return;
  const selectedNodeIds = selectedNodeIdsForCompletedNode(schema, events, nodeId, completed, startedIndex, completedIndex);
  for (const selectedNodeId of selectedNodeIds) {
    recoverPendingSuccessor(schema, events, completedIndex, selectedNodeId, pendingNodeIds, visited);
  }
}

function selectedNodeIdsForCompletedNode(
  schema: ArchitectureSchema,
  events: ArchitectureExecutionEvent[],
  nodeId: string,
  completed: ArchitectureExecutionEvent,
  startedIndex: number,
  completedIndex: number,
): string[] {
  const selected = stringArray(completed.data?.['selectedNodeIds']);
  if (selected) return selected;

  const route = events.slice(Math.max(0, startedIndex), completedIndex).reverse()
    .find((event) => event.type === 'router_decision' && event.nodeId === nodeId);
  const routed = route?.route?.selectedNodeIds ?? stringArray(route?.data?.['selectedNodeIds']);
  if (routed) return routed;

  const node = schema.nodes.find((candidate) => candidate.id === nodeId);
  return node && (node.kind === 'role' || node.kind === 'parallel' || node.kind === 'artifact')
    ? schema.edges.filter((edge) => edge.fromNodeId === nodeId).map((edge) => edge.toNodeId)
    : [];
}

function stringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((nodeId) => typeof nodeId === 'string')
    ? value
    : undefined;
}

function lastEventIndex(
  events: ArchitectureExecutionEvent[],
  nodeId: string,
  type: ArchitectureExecutionEvent['type'],
  afterIndex = -1,
): number {
  for (let index = events.length - 1; index > afterIndex; index -= 1) {
    const event = events[index];
    if (event?.nodeId === nodeId && event.type === type) return index;
  }
  return -1;
}

export function assignNextArchitectureEventSequence(
  event: ArchitectureExecutionEvent,
  existingEvents: ArchitectureExecutionEvent[],
  reservedSequence = 0,
): number {
  const nextSequence = Math.max(reservedSequence, 0, ...existingEvents.map((candidate) => candidate.sequence)) + 1;
  if (event.sequence < nextSequence) {
    event.sequence = nextSequence;
    if (typeof event.data?.['autoRoutingVisit'] !== 'number') {
      event.id = `${event.runId}:event:${nextSequence}`;
    }
  }
  return event.sequence;
}

function isNumberRecord(value: unknown): value is Record<string, number> {
  return typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
    && Object.values(value).every((candidate) => typeof candidate === 'number' && Number.isFinite(candidate) && candidate >= 0);
}
