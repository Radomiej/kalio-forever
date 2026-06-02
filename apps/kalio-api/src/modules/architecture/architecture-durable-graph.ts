import type { ArchitectureGraphProjection, ArchitectureSchema, ChatMessage } from '@kalio/types';
import type { SessionsService } from '../chat/sessions.service';
import type { ArchitectureRegistryService } from './architecture-registry.service';
import { isCompletedCliChildStatus } from './architecture-cli-child-status';

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
    if (!session.id.includes(runId) && !session.parentSessionId?.includes(`arch-${runId}-`)) {
      const sessionMessages = await sessions.getMessages(session.id);
      if (sessionMessages.some((message) => messageReferencesArchitectureRun(message, runId))) {
        messages.push(...sessionMessages);
      }
      continue;
    }
    messages.push(...await sessions.getMessages(session.id));
  }
  return messages;
}

function messageReferencesArchitectureRun(message: ChatMessage, runId: string): boolean {
  if (
    message.architectureRun?.runId === runId
    || message.id.includes(`architecture:${runId}:`)
    || message.sessionId.includes(runId)
    || message.content.includes(`arch-${runId}-`)
  ) {
    return true;
  }

  return message.toolCalls?.some((toolCall) => toolCall.args['architectureRunId'] === runId) ?? false;
}

function reconstructGraphFromMessages(
  runId: string,
  messages: ChatMessage[],
  registry: ArchitectureRegistryService,
): ArchitectureGraphProjection | null {
  const scopedMessages = messages.filter((message) => messageReferencesArchitectureRun(message, runId));
  const persistedSummary = [...scopedMessages].reverse().find((message) => message.architectureRun?.runId === runId)?.architectureRun;
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
    eventIdsByNodeId.set(nodeId, [...(eventIdsByNodeId.get(nodeId) ?? []), eventIdFromToolCallId(toolCall.id)]);
  });

  scopedMessages.forEach((message) => {
    if (message.role !== 'assistant') {
      return;
    }
    if (/^###\s+Router\b/im.test(message.content)) {
      eventIdsByNodeId.set('router', [...(eventIdsByNodeId.get('router') ?? []), message.id]);
    }
    if (/^###\s+Finalizer\b/im.test(message.content)) {
      completedNodeIds.add(primaryFinalNodeId(schema));
      eventIdsByNodeId.set(primaryFinalNodeId(schema), [...(eventIdsByNodeId.get(primaryFinalNodeId(schema)) ?? []), message.id]);
    }
  });

  const routeHops = persistedSummary?.routeHops.length
    ? persistedSummary.routeHops
    : reconstructRouteHops(schema, branchToolCalls, scopedMessages);

  routeHops.forEach((hop) => {
    completedNodeIds.add(hop.fromNodeId);
    completedNodeIds.add(hop.toNodeId);
    eventIdsByNodeId.set(hop.fromNodeId, [...(eventIdsByNodeId.get(hop.fromNodeId) ?? []), hop.eventId]);
    eventIdsByNodeId.set(hop.toNodeId, [...(eventIdsByNodeId.get(hop.toNodeId) ?? []), hop.eventId]);
  });
  markCompletedParallelNodes(schema, completedNodeIds, eventIdsByNodeId);

  return {
    runId,
    nodes: schema.nodes.map((node) => ({
      id: node.id,
      label: node.label,
      kind: node.kind,
      behavior: node.behavior ? { ...node.behavior } : undefined,
      status: completedNodeIds.has(node.id) ? 'completed' : 'pending',
      eventIds: eventIdsByNodeId.get(node.id) ?? [],
    })),
    edges: schema.edges,
    routeHops,
    childAgents: reconstructChildAgents(runId, schema, scopedMessages),
  };
}

function reconstructChildAgents(
  runId: string,
  schema: ArchitectureSchema,
  messages: ChatMessage[],
): NonNullable<ArchitectureGraphProjection['childAgents']> {
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
      const parent = inferParentFromToolCall(runId, schema, message.sessionId, toolCall.args);
      childAgents.set(childSessionId, {
        id: childSessionId,
        parentNodeId: parent.nodeId ?? previous?.parentNodeId,
        parentRoleSlotId: parent.roleSlotId ?? previous?.parentRoleSlotId,
        parentEventId: eventIdFromToolCallId(toolCall.id),
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
    const parentSessionId = snapshot ? stringField(snapshot, 'parentSessionId') : undefined;
    if (
      !snapshot
      || !childSessionId
      || !parentSessionId?.includes(`arch-${runId}-`)
      || !isCliAgentSnapshot(snapshot)
    ) {
      continue;
    }
    const previous = childAgents.get(childSessionId);
    const parent = inferParentFromToolCall(runId, schema, parentSessionId, {});
    childAgents.set(childSessionId, {
      id: childSessionId,
      parentNodeId: previous?.parentNodeId ?? parent.nodeId,
      parentRoleSlotId: previous?.parentRoleSlotId ?? parent.roleSlotId,
      parentEventId: previous?.parentEventId ?? (typeof message.toolCallId === 'string' ? eventIdFromToolCallId(message.toolCallId) : message.id),
      kind: 'cli-agent',
      backend: previous?.backend ?? stringField(snapshot, 'agentId'),
      status: latestCliStatus(previous, normalizeCliStatus(stringField(snapshot, 'status')), message.createdAt),
      toolName: previous?.toolName ?? 'run_cli_agent',
      workdir: previous?.workdir ?? stringField(snapshot, 'workdir'),
      targetPaths: previous?.targetPaths ?? targetPathsFrom('run_cli_agent', {}, snapshot),
      updatedAt: message.createdAt,
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

function inferParentFromToolCall(
  runId: string,
  schema: ArchitectureSchema,
  sessionId: string,
  args: Record<string, unknown>,
): { nodeId?: string; roleSlotId?: string } {
  const explicitNodeId = stringField(args, 'nodeId');
  const explicitRoleSlotId = stringField(args, 'roleSlotId');
  if (explicitNodeId || explicitRoleSlotId) {
    return { nodeId: explicitNodeId, roleSlotId: explicitRoleSlotId };
  }

  const branchSuffix = sessionId.startsWith(`arch-${runId}-`)
    ? sessionId.slice(`arch-${runId}-`.length)
    : undefined;
  if (!branchSuffix) {
    return {};
  }

  const normalizedSuffix = normalizeIdentifier(branchSuffix);
  const node = schema.nodes.find((candidate) => (
    normalizeIdentifier(candidate.id) === normalizedSuffix
    || normalizeIdentifier(candidate.roleSlotId ?? '') === normalizedSuffix
  ));

  return node ? { nodeId: node.id, roleSlotId: node.roleSlotId } : {};
}

function normalizeIdentifier(value: string): string {
  return value.replace(/[_-]/g, '').toLowerCase();
}

function isCliAgentToolName(name: string): boolean {
  return name === 'run_cli_agent'
    || name === 'spawn_cli_agent'
    || name === 'message_cli_agent'
    || name === 'get_cli_agent_status';
}

function parseJsonObject(content: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(content);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function targetPathsFrom(
  toolName: string,
  args: Record<string, unknown>,
  result: Record<string, unknown>,
): string[] | undefined {
  const expected = stringArrayField(args, 'expectedChangedFiles') ?? stringArrayField(result, 'expectedChangedFiles');
  if (expected) {
    return expected;
  }
  if (toolName === 'get_cli_agent_status') {
    return undefined;
  }
  const workdir = stringField(result, 'workdir') ?? stringField(args, 'workdir');
  return workdir ? [workdir] : undefined;
}

function stringArrayField(record: Record<string, unknown>, key: string): string[] | undefined {
  const value = record[key];
  if (!Array.isArray(value)) {
    return undefined;
  }
  const values = value.filter((item): item is string => typeof item === 'string' && item.length > 0);
  return values.length > 0 ? values : undefined;
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function normalizeCliStatus(status: string | undefined): NonNullable<ArchitectureGraphProjection['childAgents']>[number]['status'] | undefined {
  if (status === 'idle' || status === 'running' || status === 'completed' || status === 'failed' || status === 'stopped') {
    return status;
  }
  if (status === 'success' || status === 'exited') {
    return 'completed';
  }
  if (status === 'error') {
    return 'failed';
  }
  return undefined;
}

function schemaForPersistedRun(
  schemaId: string | undefined,
  messages: ChatMessage[],
  registry: ArchitectureRegistryService,
): ArchitectureSchema | null {
  if (schemaId) {
    const schema = registry.findOne(schemaId);
    if (schema) {
      return schema;
    }
  }

  const userHeader = messages.find((message) => message.role === 'user')
    ?.content.match(/^\[Architecture:\s*([^\]]+)\]/i)?.[1]?.trim()
    ?? messages.find((message) => message.role === 'user')
      ?.content.match(/^Architecture:\s*([^\r\n]+?)(?:\s+v\d+(?:\.\d+)*|\r?\n|$)/i)?.[1]?.trim();
  if (!userHeader) {
    return null;
  }

  return registry.findAll().find((schema) => (
    schema.id === userHeader || schema.name.toLowerCase() === userHeader.toLowerCase()
  )) ?? null;
}

function reconstructRouteHops(
  schema: ArchitectureSchema,
  branchToolCalls: NonNullable<ChatMessage['toolCalls']>,
  messages: ChatMessage[],
): NonNullable<ArchitectureGraphProjection['routeHops']> {
  const hops: NonNullable<ArchitectureGraphProjection['routeHops']> = [];
  const routerNodeId = primaryRouterNodeId(schema);
  const finalNodeId = primaryFinalNodeId(schema);

  branchToolCalls.forEach((toolCall) => {
    const nodeId = typeof toolCall.args['nodeId'] === 'string' ? toolCall.args['nodeId'] : null;
    if (!nodeId) {
      return;
    }
    hops.push({
      eventId: eventIdFromToolCallId(toolCall.id),
      source: 'agent',
      fromNodeId: nodeId,
      toNodeId: routerNodeId,
    });
  });

  const routerMessage = messages.find((message) => message.role === 'assistant' && /^###\s+Router\b/im.test(message.content));
  if (routerMessage) {
    hops.push({
      eventId: routerMessage.id,
      source: 'router',
      fromNodeId: routerNodeId,
      toNodeId: finalNodeId,
    });
  }

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

function eventIdFromToolCallId(callId: string): string {
  const architecturePrefix = callId.match(/^architecture:[^:]+:(.+)$/);
  return architecturePrefix?.[1] ?? callId;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
