import type { ArchitectureGraphProjection, ArchitectureSchema, ChatMessage } from '@kalio/types';
import type { SessionsService } from '../chat/sessions.service';
import type { ArchitectureRegistryService } from './architecture-registry.service';
import { architectureActionFieldsForEvent } from './architecture-action-summary';
import { isCompletedCliChildStatus } from './architecture-cli-child-status';
import { architectureSessionIdForRunSlot } from './architecture-session-ids';
import {
  inferParentsBySessionId,
  messageReferencesArchitectureRun,
  schemaForPersistedRun,
  sessionReferencesArchitectureRun,
} from './architecture-durable-graph.legacy';
import {
  isCliAgentToolName,
  normalizeCliStatus,
  parseJsonObject,
  stringField,
  targetPathsFrom,
} from './architecture-durable-graph.utils';

export async function reconstructDurableArchitectureGraph(
  runId: string,
  sessions: SessionsService,
  registry: ArchitectureRegistryService,
): Promise<ArchitectureGraphProjection | null> {
  const messages = await findPersistedArchitectureMessages(runId, sessions);
  if (messages.length === 0) {
    return null;
  }

  return reconstructGraphFromMessages(runId, messages, registry);
}

async function findPersistedArchitectureMessages(runId: string, sessions: SessionsService): Promise<ChatMessage[]> {
  const messages: ChatMessage[] = [];
  const chatSessions = await sessions.list({ includeArchived: true });
  for (const session of chatSessions) {
    const sessionMessages = await sessions.getMessages(session.id);
    if (sessionReferencesArchitectureRun(session, runId)) {
      messages.push(...sessionMessages);
      continue;
    }
    messages.push(...sessionMessages.filter((message) => messageReferencesArchitectureRun(message, runId)));
  }
  return messages;
}

function reconstructGraphFromMessages(
  runId: string,
  messages: ChatMessage[],
  registry: ArchitectureRegistryService,
): ArchitectureGraphProjection | null {
  const scopedMessages = messages;
  const persistedSummaryMessage = [...scopedMessages].reverse().find((message) => message.architectureRun?.runId === runId);
  const persistedSummary = persistedSummaryMessage?.architectureRun;
  const schema = schemaForPersistedRun(persistedSummary?.schemaId, scopedMessages, registry);
  if (!schema) {
    return null;
  }

  const branchToolCalls = scopedMessages
    .flatMap((message) => message.toolCalls ?? [])
    .filter((toolCall) => toolCall.name === 'run_subagent' && toolCall.args['architectureRunId'] === runId);
  const eventIdsByNodeId = new Map<string, string[]>();
  const completedNodeIds = new Set<string>();

  branchToolCalls.forEach((toolCall) => {
    const nodeId = typeof toolCall.args['nodeId'] === 'string' ? toolCall.args['nodeId'] : null;
    if (!nodeId) {
      return;
    }
    completedNodeIds.add(nodeId);
    eventIdsByNodeId.set(nodeId, [...(eventIdsByNodeId.get(nodeId) ?? []), eventIdFromToolCall(runId, toolCall)]);
  });

  if (persistedSummary?.status === 'completed' && persistedSummaryMessage) {
    const finalNodeId = primaryFinalNodeId(schema);
    completedNodeIds.add(finalNodeId);
    eventIdsByNodeId.set(finalNodeId, [...(eventIdsByNodeId.get(finalNodeId) ?? []), persistedSummaryMessage.id]);
  }

  const routeHops = persistedSummary?.routeHops.length
    ? persistedSummary.routeHops
    : reconstructRouteHops(runId, schema, branchToolCalls);

  routeHops.forEach((hop) => {
    completedNodeIds.add(hop.fromNodeId);
    completedNodeIds.add(hop.toNodeId);
    eventIdsByNodeId.set(hop.fromNodeId, [...(eventIdsByNodeId.get(hop.fromNodeId) ?? []), hop.eventId]);
    eventIdsByNodeId.set(hop.toNodeId, [...(eventIdsByNodeId.get(hop.toNodeId) ?? []), hop.eventId]);
  });
  markCompletedParallelNodes(schema, completedNodeIds, eventIdsByNodeId);

  return {
    runId,
    nodes: schema.nodes.map((node) => {
      const actionFields = reconstructedNodeActionFields(node.id, node.kind, completedNodeIds, routeHops);
      return {
        id: node.id,
        sessionId: sessionIdForNode(runId, node.roleSlotId ?? node.id),
        label: node.label,
        kind: node.kind,
        behavior: node.behavior ? { ...node.behavior } : undefined,
        status: completedNodeIds.has(node.id) ? 'completed' : 'pending',
        actionSummary: actionFields.actionSummary,
        action: actionFields.action,
        detail: actionFields.detail,
        eventIds: eventIdsByNodeId.get(node.id) ?? [],
      };
    }),
    edges: schema.edges,
    routeHops,
    childAgents: reconstructChildAgents(runId, schema, scopedMessages),
  };
}

function eventIdFromToolCall(runId: string, toolCall: NonNullable<ChatMessage['toolCalls']>[number]): string {
  const legacyPrefix = `architecture:${runId}:`;
  if (toolCall.id.startsWith(legacyPrefix)) {
    return toolCall.id.slice(legacyPrefix.length);
  }
  return stringField(toolCall.args, 'architectureEventId')
    ?? stringField(toolCall.args, 'eventId')
    ?? toolCall.id;
}

function sessionIdForNode(runId: string, slotOrNodeId: string | undefined): string | undefined {
  return architectureSessionIdForRunSlot(runId, slotOrNodeId);
}

function reconstructedNodeActionFields(
  nodeId: string,
  nodeKind: ArchitectureGraphProjection['nodes'][number]['kind'],
  completedNodeIds: Set<string>,
  routeHops: NonNullable<ArchitectureGraphProjection['routeHops']>,
): ReturnType<typeof architectureActionFieldsForEvent> {
  const routeHop = routeHops.find((hop) => hop.fromNodeId === nodeId);
  if (routeHop) {
    return architectureActionFieldsForEvent({
      type: routeHop.source === 'router' ? 'router_decision' : 'participant_output',
      route: {
        source: routeHop.source,
        fromNodeId: routeHop.fromNodeId,
        selectedNodeIds: [routeHop.toNodeId],
        nextNodeId: routeHop.toNodeId,
      },
    }, nodeKind);
  }
  if (nodeKind === 'artifact' && completedNodeIds.has(nodeId)) {
    return architectureActionFieldsForEvent({ type: 'final_artifact' }, nodeKind);
  }
  return {};
}

function reconstructChildAgents(
  runId: string,
  schema: ArchitectureSchema,
  messages: ChatMessage[],
): NonNullable<ArchitectureGraphProjection['childAgents']> {
  const parentBySessionId = inferParentsBySessionId(schema, messages);
  const toolResults = new Map<string, Record<string, unknown>>();
  messages
    .filter((message) => message.role === 'tool_result' && typeof message.toolCallId === 'string')
    .forEach((message) => {
      const result = parseJsonObject(message.content);
      if (result) {
        toolResults.set(message.toolCallId as string, result);
      }
    });

  const childAgents = new Map<string, NonNullable<ArchitectureGraphProjection['childAgents']>[number]>();
  for (const message of messages) {
    for (const toolCall of message.toolCalls ?? []) {
      if (!isCliAgentToolName(toolCall.name)) {
        continue;
      }
      const result = toolResults.get(toolCall.id) ?? {};
      const childSessionId = stringField(result, 'childSessionId') ?? stringField(toolCall.args, 'childSessionId');
      if (!childSessionId) {
        continue;
      }
      const previous = childAgents.get(childSessionId);
      const parent = inferParentFromToolCall(schema, toolCall.args);
      const sessionParent = parentBySessionId.get(message.sessionId);
      childAgents.set(childSessionId, {
        id: childSessionId,
        parentNodeId: parent.nodeId ?? sessionParent?.nodeId ?? previous?.parentNodeId,
        parentRoleSlotId: parent.roleSlotId ?? sessionParent?.roleSlotId ?? previous?.parentRoleSlotId,
        parentEventId: eventIdFromToolCall(runId, toolCall),
        kind: 'cli-agent',
        backend: stringField(result, 'agentId') ?? stringField(toolCall.args, 'agentId') ?? previous?.backend,
        status: latestCliStatus(previous, normalizeCliStatus(stringField(result, 'status')), message.createdAt),
        toolName: toolCall.name,
        workdir: stringField(result, 'workdir') ?? stringField(toolCall.args, 'workdir') ?? previous?.workdir,
        targetPaths: targetPathsFrom(toolCall.name, toolCall.args, result) ?? previous?.targetPaths,
        updatedAt: message.createdAt,
      });
    }

    if (message.role !== 'tool_result') {
      continue;
    }
    const snapshot = parseJsonObject(message.content);
    const childSessionId = snapshot ? stringField(snapshot, 'childSessionId') : undefined;
    if (
      !snapshot
      || !childSessionId
      || !isCliAgentSnapshot(snapshot)
    ) {
      continue;
    }
    const previous = childAgents.get(childSessionId);
    const parent = inferParentFromToolCall(schema, snapshot);
    const incomingStatus = normalizeCliStatus(stringField(snapshot, 'status'));
    const sessionParent = parentBySessionId.get(stringField(snapshot, 'parentSessionId') ?? message.sessionId);
    childAgents.set(childSessionId, {
      id: childSessionId,
      parentNodeId: previous?.parentNodeId ?? parent.nodeId ?? sessionParent?.nodeId,
      parentRoleSlotId: previous?.parentRoleSlotId ?? parent.roleSlotId ?? sessionParent?.roleSlotId,
      parentEventId: previous?.parentEventId ?? message.id,
      kind: 'cli-agent',
      backend: previous?.backend ?? stringField(snapshot, 'agentId'),
      status: latestCliStatus(previous, incomingStatus, message.createdAt),
      toolName: previous?.toolName ?? 'run_cli_agent',
      workdir: previous?.workdir ?? stringField(snapshot, 'workdir'),
      targetPaths: previous?.targetPaths ?? targetPathsFrom('run_cli_agent', {}, snapshot),
      updatedAt: latestCliUpdatedAt(previous, incomingStatus, message.createdAt),
    });
  }
  return [...childAgents.values()];
}

function isCliAgentSnapshot(snapshot: Record<string, unknown>): boolean {
  return stringField(snapshot, 'agentId') !== undefined
    || stringField(snapshot, 'workdir') !== undefined
    || stringField(snapshot, 'status') !== undefined
    || typeof snapshot['exitCode'] === 'number';
}

function latestCliStatus(
  previous: NonNullable<ArchitectureGraphProjection['childAgents']>[number] | undefined,
  incoming: NonNullable<ArchitectureGraphProjection['childAgents']>[number]['status'] | undefined,
  incomingUpdatedAt: number,
): NonNullable<ArchitectureGraphProjection['childAgents']>[number]['status'] {
  if (!incoming) {
    return previous?.status ?? 'unknown';
  }
  if (previous && isCompletedCliChildStatus(previous.status) && !isCompletedCliChildStatus(incoming)) {
    return previous.status;
  }
  if (!previous || previous.updatedAt === undefined || incomingUpdatedAt >= previous.updatedAt) {
    return incoming;
  }
  return previous.status;
}

function latestCliUpdatedAt(
  previous: NonNullable<ArchitectureGraphProjection['childAgents']>[number] | undefined,
  incoming: NonNullable<ArchitectureGraphProjection['childAgents']>[number]['status'] | undefined,
  incomingUpdatedAt: number,
): number {
  if (!previous?.updatedAt || (incoming && incoming !== previous.status)) {
    return incomingUpdatedAt;
  }
  return previous.updatedAt;
}

function inferParentFromToolCall(
  schema: ArchitectureSchema,
  args: Record<string, unknown>,
): { nodeId?: string; roleSlotId?: string } {
  const explicitNodeId = stringField(args, 'nodeId');
  const explicitRoleSlotId = stringField(args, 'roleSlotId');
  if (!explicitNodeId && !explicitRoleSlotId) {
    return {};
  }
  const node = schema.nodes.find((candidate) => (
    candidate.id === explicitNodeId
    || candidate.roleSlotId === explicitRoleSlotId
    || candidate.id === explicitRoleSlotId
  ));
  return {
    nodeId: explicitNodeId ?? node?.id,
    roleSlotId: explicitRoleSlotId ?? node?.roleSlotId,
  };
}

function reconstructRouteHops(
  runId: string,
  schema: ArchitectureSchema,
  branchToolCalls: NonNullable<ChatMessage['toolCalls']>,
): NonNullable<ArchitectureGraphProjection['routeHops']> {
  const hops: NonNullable<ArchitectureGraphProjection['routeHops']> = [];
  const routerNodeId = primaryRouterNodeId(schema);

  branchToolCalls.forEach((toolCall) => {
    const nodeId = typeof toolCall.args['nodeId'] === 'string' ? toolCall.args['nodeId'] : null;
    if (!nodeId) {
      return;
    }
    hops.push({
      eventId: eventIdFromToolCall(runId, toolCall),
      source: 'agent',
      fromNodeId: nodeId,
      toNodeId: routerNodeId,
    });
  });

  return hops;
}

function primaryRouterNodeId(schema: ArchitectureSchema): string {
  return schema.nodes.find((node) => node.kind === 'router')?.id ?? 'router';
}

function primaryFinalNodeId(schema: ArchitectureSchema): string {
  return schema.nodes.find((node) => node.kind === 'artifact')?.id ?? 'final-artifact';
}

function markCompletedParallelNodes(
  schema: ArchitectureSchema,
  completedNodeIds: Set<string>,
  eventIdsByNodeId: Map<string, string[]>,
): void {
  schema.nodes
    .filter((node) => node.kind === 'parallel')
    .forEach((node) => {
      const outgoing = schema.edges.filter((edge) => edge.fromNodeId === node.id);
      if (outgoing.length === 0 || !outgoing.every((edge) => completedNodeIds.has(edge.toNodeId))) {
        return;
      }
      completedNodeIds.add(node.id);
      const childEventIds = outgoing.flatMap((edge) => eventIdsByNodeId.get(edge.toNodeId) ?? []);
      eventIdsByNodeId.set(node.id, Array.from(new Set(childEventIds)));
    });
}
