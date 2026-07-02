import type {
  ArchitectureExecutionEvent,
  ArchitectureGraphNodeStatus,
  ArchitectureGraphProjection,
  ArchitectureNodeKind,
  ArchitectureRunStatus,
  ArchitectureSchema,
  ArchitectureSchemaNode,
} from '@kalio/types';
import {
  architectureActionFieldsForEvent,
  architectureCompletedActionSummaryForNodeKind,
  architectureFailedActionSummaryForNodeKind,
  architectureRunningActionSummaryForNodeKind,
} from './architecture-action-summary';
import { architectureSessionIdForRunSlot } from './architecture-session-ids';

export function buildArchitectureGraphProjection(
  runId: string,
  schema: ArchitectureSchema,
  events: ArchitectureExecutionEvent[],
  status?: ArchitectureRunStatus,
): ArchitectureGraphProjection {
  const runFailureEvent = latestRunFailureEvent(events, status);
  const cancelledDownstreamNodeIds = downstreamNodeIdsBlockedByTerminalFailure(schema, events, status, runFailureEvent);
  return {
    runId,
    schemaId: schema.id,
    schemaName: schema.name,
    status,
    nodes: schema.nodes.map((node) => toGraphNode(
      runId,
      node,
      events,
      status,
      runFailureEvent,
      cancelledDownstreamNodeIds.has(node.id),
    )),
    edges: schema.edges,
    routeHops: toRouteHops(events),
    childAgents: toChildAgents(events, status),
  };
}

function toGraphNode(
  runId: string,
  node: ArchitectureSchemaNode,
  events: ArchitectureExecutionEvent[],
  runStatus?: ArchitectureRunStatus,
  runFailureEvent?: ArchitectureExecutionEvent,
  cancelledByUpstreamFailure = false,
) {
  const nodeEvents = events.filter((event) =>
    event.nodeId !== undefined
      ? event.nodeId === node.id
      : event.roleSlotId !== undefined && event.roleSlotId === node.roleSlotId);
  const inferredFailureEvent = inferredRunFailureEventForNode(node, nodeEvents, runStatus, runFailureEvent);
  const inferredCancellationEvent = inferredFailureEvent
    ? undefined
    : inferredUpstreamCancellationEventForNode(node, nodeEvents, runStatus, runFailureEvent, cancelledByUpstreamFailure);
  const projectionEvents = inferredFailureEvent
    ? [...nodeEvents, inferredFailureEvent]
    : inferredCancellationEvent
      ? [...nodeEvents, inferredCancellationEvent]
      : nodeEvents;
  const eventIds = projectionEvents.map((event) => event.id);
  const toolEvidence = latestToolEvidence(nodeEvents);
  const incompleteReason = latestIncompleteReason(nodeEvents);
  const status = nodeStatus(projectionEvents);
  const actionFields = latestActionFields(projectionEvents, node.kind, status);
  const failureFields = latestFailureFields(projectionEvents);
  return {
    id: node.id,
    sessionId: sessionIdForNode(runId, node),
    roleSlotId: node.roleSlotId,
    label: node.label,
    kind: node.kind,
    behavior: node.behavior ? { ...node.behavior } : undefined,
    status,
    actionSummary: actionFields.actionSummary,
    action: actionFields.action,
    detail: actionFields.detail,
    errorCode: failureFields.errorCode,
    failure: failureFields.failure,
    visitCount: nodeVisitCount(nodeEvents),
    eventIds,
    toolEvidence,
    incompleteReason,
  };
}

function downstreamNodeIdsBlockedByTerminalFailure(
  schema: ArchitectureSchema,
  events: ArchitectureExecutionEvent[],
  runStatus?: ArchitectureRunStatus,
  runFailureEvent?: ArchitectureExecutionEvent,
): Set<string> {
  if (!runFailureEvent || (runStatus !== 'failed' && runStatus !== 'cancelled')) {
    return new Set();
  }
  const terminalStopNodeIds = new Set(terminalStopPendingNodeIds(schema, runFailureEvent));
  const failedNodeIds = new Set(events
    .filter((event) => (
      event.nodeId !== undefined
      && event.type === 'node_failed'
      && (event.status === 'failed' || event.status === 'cancelled' || runStatus === 'failed')
    ))
    .map((event) => event.nodeId as string));
  if (failedNodeIds.size === 0 && terminalStopNodeIds.size === 0) {
    return new Set(schema.nodes.map((node) => node.id));
  }
  const outgoingEdgesByNode = new Map<string, string[]>();
  for (const edge of schema.edges) {
    const outgoing = outgoingEdgesByNode.get(edge.fromNodeId) ?? [];
    outgoing.push(edge.toNodeId);
    outgoingEdgesByNode.set(edge.fromNodeId, outgoing);
  }
  const blocked = new Set<string>(terminalStopNodeIds);
  const stack = [...failedNodeIds, ...terminalStopNodeIds];
  while (stack.length > 0) {
    const nodeId = stack.pop();
    if (!nodeId) {
      continue;
    }
    for (const downstreamNodeId of outgoingEdgesByNode.get(nodeId) ?? []) {
      if (blocked.has(downstreamNodeId) || failedNodeIds.has(downstreamNodeId)) {
        continue;
      }
      blocked.add(downstreamNodeId);
      stack.push(downstreamNodeId);
    }
  }
  return blocked;
}

function terminalStopPendingNodeIds(
  schema: ArchitectureSchema,
  runFailureEvent: ArchitectureExecutionEvent,
): string[] {
  const rawPendingNodeIds = runFailureEvent.data?.['pendingNodeIds'];
  if (!Array.isArray(rawPendingNodeIds)) {
    return [];
  }
  const schemaNodeIds = new Set(schema.nodes.map((node) => node.id));
  return rawPendingNodeIds.filter((nodeId): nodeId is string => (
    typeof nodeId === 'string' && schemaNodeIds.has(nodeId)
  ));
}

function inferredUpstreamCancellationEventForNode(
  node: ArchitectureSchemaNode,
  nodeEvents: ArchitectureExecutionEvent[],
  runStatus?: ArchitectureRunStatus,
  runFailureEvent?: ArchitectureExecutionEvent,
  cancelledByUpstreamFailure = false,
): ArchitectureExecutionEvent | undefined {
  if (!cancelledByUpstreamFailure || !runFailureEvent || (runStatus !== 'failed' && runStatus !== 'cancelled')) {
    return undefined;
  }
  if (latestNodeTerminalStatus(nodeEvents) || isNodeRunning(nodeEvents)) {
    return undefined;
  }
  return {
    ...runFailureEvent,
    type: 'node_failed',
    action: 'node_failed',
    nodeId: node.id,
    roleSlotId: node.roleSlotId,
    status: 'cancelled',
    detail: runFailureEvent.reasonCode === 'max_steps' || runFailureEvent.reasonCode === 'max_node_visits'
      ? 'Skipped because the workflow stopped before this node started.'
      : 'Skipped because an upstream workflow node failed before this node started.',
  };
}

function latestRunFailureEvent(
  events: ArchitectureExecutionEvent[],
  status?: ArchitectureRunStatus,
): ArchitectureExecutionEvent | undefined {
  if (status !== 'failed' && status !== 'cancelled') {
    return undefined;
  }
  const runLevelFailure = [...events].reverse().find((event) => (
    event.nodeId === undefined
    && event.roleSlotId === undefined
    && (
      event.failure !== undefined
      || event.errorCode !== undefined
      || event.reasonCode !== undefined
      || event.runtimeDecision?.reasonCode !== undefined
      || event.status === 'failed'
      || event.status === 'cancelled'
    )
  ));
  if (runLevelFailure) {
    return runLevelFailure;
  }
  return [...events].reverse().find((event) => (
    event.type === 'node_failed'
    && (
      event.failure !== undefined
      || event.errorCode !== undefined
      || event.reasonCode !== undefined
      || event.status === 'failed'
      || event.status === 'cancelled'
    )
  ));
}

function inferredRunFailureEventForNode(
  node: ArchitectureSchemaNode,
  nodeEvents: ArchitectureExecutionEvent[],
  runStatus?: ArchitectureRunStatus,
  runFailureEvent?: ArchitectureExecutionEvent,
): ArchitectureExecutionEvent | undefined {
  if (!runFailureEvent || (runStatus !== 'failed' && runStatus !== 'cancelled')) {
    return undefined;
  }
  if (latestNodeTerminalStatus(nodeEvents) || !isNodeRunning(nodeEvents)) {
    return undefined;
  }
  const lastNodeEvent = [...nodeEvents].sort(compareArchitectureEvents).at(-1);
  if (lastNodeEvent && compareArchitectureEvents(lastNodeEvent, runFailureEvent) > 0) {
    return undefined;
  }
  return {
    ...runFailureEvent,
    type: 'node_failed',
    action: 'node_failed',
    nodeId: node.id,
    roleSlotId: node.roleSlotId,
    status: runStatus === 'cancelled' || runFailureEvent.status === 'cancelled' ? 'cancelled' : 'failed',
    detail: runFailureEvent.failure?.message ?? runFailureEvent.detail,
  };
}

function compareArchitectureEvents(left: ArchitectureExecutionEvent, right: ArchitectureExecutionEvent): number {
  if (left.sequence !== right.sequence) {
    return left.sequence - right.sequence;
  }
  return left.createdAt - right.createdAt;
}

function sessionIdForNode(runId: string, node: ArchitectureSchemaNode): string | undefined {
  if (!runId) {
    return undefined;
  }
  return architectureSessionIdForRunSlot(runId, node.roleSlotId ?? node.id);
}

function latestToolEvidence(events: ArchitectureExecutionEvent[]): Record<string, unknown> | undefined {
  return [...events]
    .reverse()
    .map((event) => event.data?.['toolEvidence'])
    .find((value): value is Record<string, unknown> => (
      typeof value === 'object'
      && value !== null
      && !Array.isArray(value)
    ));
}

function latestIncompleteReason(events: ArchitectureExecutionEvent[]): string | undefined {
  return [...events]
    .reverse()
    .map((event) => event.data?.['incompleteReason'])
    .find((value): value is string => typeof value === 'string' && value.length > 0);
}

function latestFailureFields(events: ArchitectureExecutionEvent[]): Pick<
  ArchitectureGraphProjection['nodes'][number],
  'errorCode' | 'failure'
> {
  for (const event of [...events].reverse()) {
    if (event.errorCode || event.failure) {
      return {
        errorCode: event.errorCode ?? event.failure?.code,
        failure: event.failure,
      };
    }
  }
  return {};
}

function latestActionFields(
  events: ArchitectureExecutionEvent[],
  nodeKind: ArchitectureNodeKind,
  status: ArchitectureGraphNodeStatus,
): ReturnType<typeof architectureActionFieldsForEvent> {
  for (const event of [...events].reverse()) {
    const fields = architectureActionFieldsForEvent(event, nodeKind);
    if (fields.actionSummary || fields.action || fields.detail) {
      return fields;
    }
  }
  if (status === 'running') {
    return { actionSummary: architectureRunningActionSummaryForNodeKind(nodeKind) };
  }
  if (status === 'completed') {
    return { actionSummary: architectureCompletedActionSummaryForNodeKind(nodeKind) };
  }
  if (status === 'failed') {
    return { actionSummary: architectureFailedActionSummaryForNodeKind(nodeKind) };
  }
  return {};
}

function nodeStatus(events: ArchitectureExecutionEvent[]): ArchitectureGraphNodeStatus {
  const terminalStatus = latestNodeTerminalStatus(events);
  if (terminalStatus) {
    return terminalStatus;
  }
  if (isNodeRunning(events)) {
    return 'running';
  }
  return 'pending';
}

function latestNodeTerminalStatus(events: ArchitectureExecutionEvent[]): ArchitectureGraphNodeStatus | undefined {
  for (const event of [...events].reverse()) {
    if (
      event.type === 'node_completed'
      || event.type === 'participant_output'
      || event.type === 'router_output'
      || event.type === 'final_artifact'
      || event.type === 'artifact_created'
    ) {
      return 'completed';
    }
    if (event.type === 'node_failed') {
      return event.status === 'cancelled' ? 'cancelled' : 'failed';
    }
  }
  return undefined;
}

function isNodeRunning(events: ArchitectureExecutionEvent[]): boolean {
  return events.some((event) => (
    event.type === 'node_started'
    || event.type === 'agent_started'
    || event.type === 'tool_call'
    || event.type === 'human_gate'
  ));
}

function nodeVisitCount(events: ArchitectureExecutionEvent[]): number {
  const starts = events.filter((event) => event.type === 'node_started').length;
  if (starts > 0) {
    return starts;
  }
  return events.some((event) => (
    event.type === 'agent_started'
    || event.type === 'tool_call'
    || event.type === 'human_gate'
  )) ? 1 : 0;
}

function toRouteHops(events: ArchitectureExecutionEvent[]): NonNullable<ArchitectureGraphProjection['routeHops']> {
  return events.filter((event) => event.type === 'participant_output' || event.type === 'router_decision').flatMap((event) => {
    const route = event.route;
    return route?.selectedNodeIds.map((toNodeId) => ({
      eventId: event.id,
      source: route.source,
      fromNodeId: route.fromNodeId,
      toNodeId,
    })) ?? [];
  });
}

function toChildAgents(
  events: ArchitectureExecutionEvent[],
  runStatus?: ArchitectureRunStatus,
): NonNullable<ArchitectureGraphProjection['childAgents']> {
  const childAgents = new Map<string, NonNullable<ArchitectureGraphProjection['childAgents']>[number]>();
  for (const event of events) {
    const evidence = latestToolEvidence([event]);
    const sessions = Array.isArray(evidence?.['childCliSessions']) ? evidence['childCliSessions'] : [];
    for (const rawSession of sessions) {
      if (!isRecord(rawSession) || typeof rawSession['childSessionId'] !== 'string') {
        continue;
      }
      const id = rawSession['childSessionId'];
      const previous = childAgents.get(id);
      childAgents.set(id, {
        id,
        parentNodeId: event.nodeId ?? previous?.parentNodeId,
        parentRoleSlotId: event.roleSlotId ?? previous?.parentRoleSlotId,
        parentEventId: event.id,
        kind: 'cli-agent',
        backend: typeof rawSession['agentId'] === 'string' ? rawSession['agentId'] : previous?.backend,
        status: childAgentStatusForRun(
          normalizeChildAgentStatus(rawSession['status']) ?? previous?.status ?? 'unknown',
          runStatus,
        ),
        toolName: latestCliToolName(evidence) ?? previous?.toolName ?? 'spawn_cli_agent',
        workdir: typeof rawSession['workdir'] === 'string' ? rawSession['workdir'] : previous?.workdir,
        targetPaths: latestTargetPaths(evidence) ?? previous?.targetPaths,
        updatedAt: event.createdAt,
      });
    }
  }
  return [...childAgents.values()];
}

function childAgentStatusForRun(
  status: NonNullable<ArchitectureGraphProjection['childAgents']>[number]['status'],
  runStatus?: ArchitectureRunStatus,
): NonNullable<ArchitectureGraphProjection['childAgents']>[number]['status'] {
  if ((runStatus === 'failed' || runStatus === 'cancelled') && (
    status === 'idle'
    || status === 'running'
    || status === 'unknown'
  )) {
    return 'stopped';
  }
  return status;
}

function latestCliToolName(evidence: Record<string, unknown> | undefined): string | undefined {
  const names = Array.isArray(evidence?.['successfulToolNames']) ? evidence['successfulToolNames'] : [];
  return [...names].reverse().find((name): name is string => (
    typeof name === 'string'
    && (
      name === 'run_cli_agent'
      || name === 'spawn_cli_agent'
      || name === 'message_cli_agent'
      || name === 'get_cli_agent_status'
    )
  ));
}

function latestTargetPaths(evidence: Record<string, unknown> | undefined): string[] | undefined {
  const paths = Array.isArray(evidence?.['targetPaths'])
    ? evidence['targetPaths'].filter((path): path is string => typeof path === 'string')
    : [];
  return paths.length > 0 ? paths : undefined;
}

function normalizeChildAgentStatus(value: unknown): NonNullable<ArchitectureGraphProjection['childAgents']>[number]['status'] | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  if (value === 'idle' || value === 'running' || value === 'completed' || value === 'failed' || value === 'stopped') {
    return value;
  }
  if (value === 'terminal-success' || value === 'success' || value === 'exited') {
    return 'completed';
  }
  if (value === 'error') {
    return 'failed';
  }
  return 'unknown';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
