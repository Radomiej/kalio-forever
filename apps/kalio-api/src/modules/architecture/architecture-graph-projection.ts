import type {
  ArchitectureExecutionEvent,
  ArchitectureGraphProjection,
  ArchitectureRunStatus,
  ArchitectureSchema,
  ArchitectureSchemaNode,
} from '@kalio/types';

export function buildArchitectureGraphProjection(
  runId: string,
  schema: ArchitectureSchema,
  events: ArchitectureExecutionEvent[],
  status?: ArchitectureRunStatus,
): ArchitectureGraphProjection {
  return {
    runId,
    status,
    nodes: schema.nodes.map((node) => toGraphNode(node, events)),
    edges: schema.edges,
    routeHops: toRouteHops(events),
    childAgents: toChildAgents(events),
  };
}

function toGraphNode(node: ArchitectureSchemaNode, events: ArchitectureExecutionEvent[]) {
  const nodeEvents = events.filter((event) =>
    event.nodeId !== undefined
      ? event.nodeId === node.id
      : event.roleSlotId !== undefined && event.roleSlotId === node.roleSlotId);
  const eventIds = nodeEvents.map((event) => event.id);
  const toolEvidence = latestToolEvidence(nodeEvents);
  const incompleteReason = latestIncompleteReason(nodeEvents);
  return {
    id: node.id,
    label: node.label,
    kind: node.kind,
    behavior: node.behavior ? { ...node.behavior } : undefined,
    status: nodeStatus(nodeEvents),
    visitCount: nodeVisitCount(nodeEvents),
    eventIds,
    toolEvidence,
    incompleteReason,
  };
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

function nodeStatus(events: ArchitectureExecutionEvent[]): 'pending' | 'running' | 'completed' {
  if (isNodeCompleted(events)) {
    return 'completed';
  }
  if (isNodeRunning(events)) {
    return 'running';
  }
  return 'pending';
}

function isNodeCompleted(events: ArchitectureExecutionEvent[]): boolean {
  return events.some((event) => (
    event.type === 'node_completed'
    || event.type === 'participant_output'
    || event.type === 'router_output'
    || event.type === 'final_artifact'
    || event.type === 'artifact_created'
  ));
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

function toChildAgents(events: ArchitectureExecutionEvent[]): NonNullable<ArchitectureGraphProjection['childAgents']> {
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
        status: normalizeChildAgentStatus(rawSession['status']) ?? previous?.status ?? 'unknown',
        toolName: latestCliToolName(evidence) ?? previous?.toolName ?? 'spawn_cli_agent',
        workdir: typeof rawSession['workdir'] === 'string' ? rawSession['workdir'] : previous?.workdir,
        targetPaths: latestTargetPaths(evidence) ?? previous?.targetPaths,
        updatedAt: event.createdAt,
      });
    }
  }
  return [...childAgents.values()];
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
  if (value === 'success' || value === 'exited') {
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
