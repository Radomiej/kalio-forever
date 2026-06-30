import type {
  ArchitectureBranchStreamSummary,
  ArchitectureGraphProjection,
  ArchitectureChatRunSummary,
  ChatMessage,
  LLMToolCall,
  SubagentToolResult,
} from '@kalio/types';
import { architectureSessionIdForRunSlot } from '@kalio/types';
import type { AgentTurnItem } from '../../store/sessionStore';
import type { ArchitectRunResult } from '../architect/architect.types';
import { sanitizeRouterOutput } from './architectureRouterOutput';
import { streamFromEventData } from './architectureStreamSummary';
import { parseSubagentToolResult } from './architectureSubagentToolResult';
import { architectureTraceActivitySummary, compactArchitectureTraceContent } from './architectureTraceContent';

export { architectureTraceActivitySummary, compactArchitectureTraceContent } from './architectureTraceContent';

type TraceSpeaker = ArchitectureChatRunSummary['trace'][number]['speaker'];
type ArchitectureRunChatMessage = ArchitectRunResult['chat']['messages'][number] & { speaker: TraceSpeaker };
export type ArchitectureGraphNodeSummary = Pick<
  ArchitectureGraphProjection['nodes'][number],
  'id' | 'sessionId' | 'label' | 'kind' | 'behavior' | 'status' | 'eventIds' | 'incompleteReason'
>;
export type ArchitectureRunSummaryWithGraph = ArchitectureChatRunSummary & {
  graphNodes?: ArchitectureGraphNodeSummary[];
  graphEdges?: ArchitectureGraphProjection['edges'];
  graphChildAgents?: ArchitectureGraphProjection['childAgents'];
};

export type ArchitectureChatTurnDraft = {
  content: string;
  attachRunMetadata: boolean;
};

export type ArchitectureRunTurnProjection = {
  messages: ChatMessage[];
  turnItems: AgentTurnItem[];
  turnKind: 'workflow-envelope';
};

function isTraceSpeaker(value: string): value is TraceSpeaker {
  return value === 'participant' || value === 'router' || value === 'finalizer';
}

function formatRouteLabel(source: string, fromNodeId: string, toNodeId: string): string {
  return `${source}: ${fromNodeId} -> ${toNodeId}`;
}

export function buildArchitectureRunMetadata(result: ArchitectRunResult): ArchitectureChatRunSummary {
  const chatMessages = result.chat.messages ?? [];
  const graphNodes = result.graph.nodes ?? [];
  const graphEdges = result.graph.edges ?? [];
  const graphChildAgents = result.graph.childAgents ?? [];
  const schemaLabel = resolveArchitectureSchemaLabel(result);
  const visitIndexByEventId = buildVisitIndexByEventId(result);
  const streamByEventId = buildStreamByEventId(result);
  const routerOutputByEventId = buildRouterOutputByEventId(result);
  const incompleteReasonByEventId = buildIncompleteReasonByEventId(result);
  const eventById = new Map(result.events.map((event) => [event.id, event]));
  const trace = chatMessages
    .filter((message): message is typeof message & { speaker: TraceSpeaker } => isTraceSpeaker(message.speaker))
    .map((message) => {
      const event = message.eventId ? eventById.get(message.eventId) : undefined;
      return {
        speaker: message.speaker,
        content: compactArchitectureTraceContent(message.content, message.speaker),
        actionSummary: message.actionSummary,
        action: message.action,
        detail: message.detail,
        lifecycle: event?.lifecycle,
        status: event?.status,
        reasonCode: event?.reasonCode,
        errorCode: event?.errorCode,
        failure: event?.failure,
        evidence: event?.evidence,
        runtimeDecision: event?.runtimeDecision,
        eventId: message.eventId,
        sessionId: graphNodes.find((node) => (
          node.id === message.route?.fromNodeId
          || (message.eventId !== undefined && node.eventIds.includes(message.eventId))
        ))?.sessionId,
        nodeId: message.route?.fromNodeId,
        nextNodeId: message.route?.nextNodeId,
        visitIndex: visitIndexByEventId.get(message.eventId),
        incompleteReason: message.incompleteReason ?? incompleteReasonByEventId.get(message.eventId),
        routerOutput: sanitizeRouterOutput(routerOutputByEventId.get(message.eventId)),
        stream: streamByEventId.get(message.eventId),
      };
    });
  const metadata: ArchitectureRunSummaryWithGraph = {
    runId: result.run.id,
    schemaId: schemaLabel,
    status: result.run.status,
    hostProjectionKind: 'workflow-envelope',
    finalArtifact: [...chatMessages]
      .reverse()
      .find((message) => message.speaker === 'finalizer')
      ? compactArchitectureTraceContent(
          [...chatMessages].reverse().find((message) => message.speaker === 'finalizer')?.content ?? '',
          'finalizer',
        )
      : undefined,
    trace,
    routeHops: result.graph.routeHops ?? [],
    graphNodes: graphNodes.map((node) => ({
      id: node.id,
      sessionId: node.sessionId,
      label: node.label,
      kind: node.kind,
      behavior: node.behavior,
      status: node.status,
      eventIds: [...node.eventIds],
      incompleteReason: node.incompleteReason,
    })),
    graphEdges: graphEdges.map((edge) => ({ ...edge })),
    graphChildAgents: graphChildAgents.map((agent) => ({ ...agent })),
  };
  return metadata;
}

export function findArchitectureRunInMessages(messages: ChatMessage[]): ArchitectureChatRunSummary | null {
  const persisted = [...messages].reverse().find((message) => message.architectureRun)?.architectureRun;
  if (persisted) {
    return persisted;
  }

  const toolCalls = messages
    .filter((message) => message.role === 'assistant' && message.toolCalls)
    .flatMap((message) => message.toolCalls ?? [])
    .filter((toolCall) => toolCall.name === 'run_subagent' && typeof toolCall.args['architectureRunId'] === 'string');
  if (toolCalls.length === 0) {
    return null;
  }

  const runId = toolCalls[0].args['architectureRunId'] as string;
  const schemaLabel = typeof toolCalls[0].args['schemaName'] === 'string'
    ? toolCalls[0].args['schemaName']
    : typeof toolCalls[0].args['schemaId'] === 'string'
      ? toolCalls[0].args['schemaId']
      : 'architecture-run';
  const resultByCallId = new Map<string, SubagentToolResult>();
  messages
    .filter((message) => message.role === 'tool_result' && message.toolCallId)
    .forEach((message) => {
      const result = parseSubagentToolResult(message.content);
      if (result && message.toolCallId) {
        resultByCallId.set(message.toolCallId, result);
      }
    });

  const participantTrace = toolCalls.map((toolCall): ArchitectureChatRunSummary['trace'][number] => {
    const result = resultByCallId.get(toolCall.id);
    const nodeId = typeof toolCall.args['nodeId'] === 'string' ? toolCall.args['nodeId'] : undefined;
    return {
      speaker: 'participant',
      content: result?.result ?? '',
      actionSummary: architectureTraceActivitySummary('participant'),
      action: 'participant_completed',
      detail: nodeId ? `Ready for ${nodeId}.` : 'Output recorded.',
      eventId: typeof result?.taskId === 'string' ? result.taskId : toolCall.id,
      nodeId,
      nextNodeId: 'router',
      stream: result
        ? {
            streamGroupId: runId,
            branchSessionId: result.childSessionId,
            status: 'completed',
            chunkCount: 0,
            text: result.result,
          }
        : undefined,
    };
  });

  return {
    runId,
    schemaId: schemaLabel,
    status: 'running',
    hostProjectionKind: 'workflow-envelope',
    trace: participantTrace.sort(compareTraceByArchitectureEvent),
    routeHops: [],
  };
}

function compareTraceByArchitectureEvent(
  left: ArchitectureChatRunSummary['trace'][number],
  right: ArchitectureChatRunSummary['trace'][number],
): number {
  const leftSequence = architectureEventSequence(left.eventId);
  const rightSequence = architectureEventSequence(right.eventId);
  if (leftSequence !== rightSequence) {
    return leftSequence - rightSequence;
  }
  return 0;
}

function architectureEventSequence(eventId: string | undefined): number {
  if (!eventId) {
    return Number.MAX_SAFE_INTEGER;
  }
  const match = /:event:(\d+)(?!.*:event:\d+)/.exec(eventId);
  return match ? Number.parseInt(match[1], 10) : Number.MAX_SAFE_INTEGER;
}

function buildStreamByEventId(result: ArchitectRunResult): Map<string, ArchitectureBranchStreamSummary> {
  const streamByEventId = new Map<string, ArchitectureBranchStreamSummary>();
  for (const event of result.events) {
    const stream = streamFromEventData(event.data);
    if (stream) {
      streamByEventId.set(event.id, stream);
    }
  }
  return streamByEventId;
}

function buildRouterOutputByEventId(result: ArchitectRunResult) {
  const routerOutputByEventId = new Map<string, NonNullable<ArchitectureChatRunSummary['trace'][number]['routerOutput']>>();
  for (const event of result.events) {
    if (event.routerOutput) {
      routerOutputByEventId.set(event.id, event.routerOutput);
    }
  }
  return routerOutputByEventId;
}

function buildIncompleteReasonByEventId(result: ArchitectRunResult): Map<string, string> {
  const incompleteReasonByEventId = new Map<string, string>();
  for (const event of result.events) {
    const reason = event.data?.['incompleteReason'];
    if (typeof reason === 'string' && reason.trim().length > 0) {
      incompleteReasonByEventId.set(event.id, reason.trim());
    }
  }
  return incompleteReasonByEventId;
}

function resolveArchitectureSchemaLabel(result: ArchitectRunResult): string {
  const graph: ArchitectureGraphProjection = result.graph;
  if (typeof graph.schemaName === 'string' && graph.schemaName.trim().length > 0) {
    return graph.schemaName.trim();
  }
  return result.run.schemaId;
}

function buildVisitIndexByEventId(result: ArchitectRunResult): Map<string, number> {
  const visitsByNodeId = new Map<string, number>();
  const visitIndexByEventId = new Map<string, number>();
  for (const event of [...result.events].sort((left, right) => left.sequence - right.sequence)) {
    if (!event.nodeId) {
      continue;
    }
    const nextVisit = (visitsByNodeId.get(event.nodeId) ?? 0) + 1;
    visitsByNodeId.set(event.nodeId, nextVisit);
    visitIndexByEventId.set(event.id, nextVisit);
  }
  return visitIndexByEventId;
}

export function buildArchitectureRunSummary(result: ArchitectRunResult): string {
  const metadata = buildArchitectureRunMetadata(result);
  const schemaLabel = resolveArchitectureSchemaLabel(result);
  const statusLabel = result.run.status === 'completed'
    ? 'completed'
    : result.run.status === 'failed'
      ? 'failed'
      : result.run.status;
  const trace = metadata.trace
    .map((step, index) => {
      const route = step.nextNodeId
        ? ` -> ${step.nextNodeId}`
        : '';
      return `${index + 1}. ${step.speaker}${route}: ${step.content}`;
    })
    .map((line, index) => {
      const reason = metadata.trace[index]?.incompleteReason;
      return reason ? `${line} [Incomplete: ${reason}]` : line;
    });
  const route = metadata.routeHops.map((hop) => (
    `- ${formatRouteLabel(hop.source, hop.fromNodeId, hop.toNodeId)}`
  ));

  return [
    `Architecture run ${statusLabel}: ${schemaLabel}`,
    metadata.finalArtifact ? `Final artifact:\n${metadata.finalArtifact}` : null,
    trace.length > 0 ? `Execution trace:\n${trace.join('\n')}` : null,
    route.length > 0 ? `Executed route:\n${route.join('\n')}` : null,
  ].filter(Boolean).join('\n\n');
}

export function buildArchitectureRunChatTurnDrafts(result: ArchitectRunResult): ArchitectureChatTurnDraft[] {
  const streamByEventId = buildStreamByEventId(result);
  const incompleteReasonByEventId = buildIncompleteReasonByEventId(result);
  const visibleMessages = result.chat.messages.filter((message): message is typeof message & { speaker: TraceSpeaker } => (
    isTraceSpeaker(message.speaker)
    && !isSyntheticParallelMessage(message.content)
  ));
  if (visibleMessages.length === 0) {
    return [{
      content: buildArchitectureRunSummary(result),
      attachRunMetadata: true,
    }];
  }

  return visibleMessages.map((message, index) => ({
    content: [
      `### ${speakerLabel(message.speaker, message.roleSlotId)}`,
      streamLine(streamByEventId.get(message.eventId)),
      routeLine(message.route?.source, message.route?.nextNodeId),
      incompleteLine(message.incompleteReason ?? incompleteReasonByEventId.get(message.eventId)),
      compactArchitectureTraceContent(message.content, message.speaker),
    ].filter(Boolean).join('\n\n'),
    attachRunMetadata: index === visibleMessages.length - 1,
  }));
}

export function buildArchitectureRunTurnProjection(
  result: ArchitectRunResult,
  sessionId: string,
): ArchitectureRunTurnProjection {
  const metadata = buildArchitectureRunMetadata(result);
  const streamByEventId = new Map(metadata.trace
    .filter((step) => step.eventId && step.stream)
    .map((step) => [step.eventId as string, step.stream as ArchitectureBranchStreamSummary]));
  const incompleteReasonByEventId = new Map(metadata.trace
    .filter((step) => step.eventId && step.incompleteReason)
    .map((step) => [step.eventId as string, step.incompleteReason as string]));
  const visibleMessages = result.chat.messages.filter((message): message is typeof message & { speaker: TraceSpeaker } => (
    isTraceSpeaker(message.speaker)
    && !isSyntheticParallelMessage(message.content)
  ));
  const branchMessages = visibleMessages.filter((message) => message.speaker === 'participant');
  const textMessages = visibleMessages.filter((message) => message.speaker !== 'participant');
  const now = Date.now();
  const messages: ChatMessage[] = [];
  const turnItems: AgentTurnItem[] = [];

  const toolCalls = branchMessages
    .map((message) => {
      const childSessionId = resolveBranchSessionId(result, message, streamByEventId.get(message.eventId));
      return childSessionId ? toSubagentToolCall(result, message, childSessionId) : null;
    })
    .filter((toolCall): toolCall is LLMToolCall => toolCall !== null);
  if (toolCalls.length > 0) {
    messages.push({
      id: `architecture:${result.run.id}:tool-calls`,
      sessionId,
      role: 'assistant',
      content: '',
      toolCalls,
      architectureRun: textMessages.length === 0 ? metadata : undefined,
      createdAt: now,
    });
    turnItems.push(...toolCalls.map((call) => ({ kind: 'tool' as const, callId: call.id })));
    branchMessages
      .map((message, index) => ({
        message,
        index,
        childSessionId: resolveBranchSessionId(result, message, streamByEventId.get(message.eventId)),
      }))
      .filter((entry): entry is typeof entry & { childSessionId: string } => Boolean(entry.childSessionId))
      .forEach(({ message, index, childSessionId }) => {
      messages.push({
        id: `architecture:${result.run.id}:tool-result:${message.eventId}`,
        sessionId,
        role: 'tool_result',
        content: JSON.stringify(toSubagentToolResult(result, sessionId, message, childSessionId)),
        toolCallId: `architecture:${result.run.id}:${message.eventId}`,
        createdAt: now + 1 + index,
      });
      });
  }

  const assistantTextMessages = textMessages.map((message, index): ChatMessage => ({
    id: `architecture:${result.run.id}:text:${message.eventId}`,
    sessionId,
    role: 'assistant',
    content: [
      `### ${speakerLabel(message.speaker, message.roleSlotId)}`,
      routeLine(message.route?.source, message.route?.nextNodeId),
      incompleteLine(message.incompleteReason ?? incompleteReasonByEventId.get(message.eventId)),
      compactArchitectureTraceContent(message.content, message.speaker),
    ].filter(Boolean).join('\n\n'),
    architectureRun: index === textMessages.length - 1 ? metadata : undefined,
    createdAt: now + 1 + branchMessages.length + index,
  }));
  messages.push(...assistantTextMessages);
  turnItems.push(...assistantTextMessages.map((message) => ({ kind: 'text' as const, messageId: message.id })));

  if (turnItems.length === 0) {
    const fallbackMessage: ChatMessage = {
      id: `architecture:${result.run.id}:text:summary`,
      sessionId,
      role: 'assistant',
      content: buildArchitectureRunSummary(result),
      architectureRun: metadata,
      createdAt: now,
    };
    messages.push(fallbackMessage);
    turnItems.push({ kind: 'text', messageId: fallbackMessage.id });
  }

  return { messages, turnItems, turnKind: 'workflow-envelope' };
}

function toSubagentToolCall(
  result: ArchitectRunResult,
  message: ArchitectureRunChatMessage,
  childSessionId: string,
): LLMToolCall {
  const schemaLabel = resolveArchitectureSchemaLabel(result);
  return {
    id: `architecture:${result.run.id}:${message.eventId}`,
    name: 'run_subagent',
    args: {
      objective: `${speakerLabel(message.speaker, message.roleSlotId)} branch for: ${result.run.prompt}`,
      architectureRunId: result.run.id,
      architectureEventId: message.eventId,
      schemaName: schemaLabel,
      nodeId: message.route?.fromNodeId,
      roleSlotId: message.roleSlotId,
      childSessionId,
    },
  };
}

function toSubagentToolResult(
  result: ArchitectRunResult,
  parentSessionId: string,
  message: ArchitectureRunChatMessage,
  childSessionId: string,
): SubagentToolResult {
  return {
    result: message.content,
    taskId: message.eventId,
    childSessionId,
    parentSessionId,
    vfsMode: 'shared',
    vfsSessionId: result.run.rootSessionId ?? parentSessionId,
    copiedFiles: [],
    durationMs: 0,
  };
}

function resolveBranchSessionId(
  result: ArchitectRunResult,
  message: ArchitectureRunChatMessage,
  stream: ArchitectureBranchStreamSummary | undefined,
): string | undefined {
  if (stream?.branchSessionId) {
    return stream.branchSessionId;
  }

  const graphNodeSessionId = result.graph.nodes.find((node) => (
    (message.route?.fromNodeId && node.id === message.route.fromNodeId)
    || (message.eventId !== undefined && node.eventIds.includes(message.eventId))
  ))?.sessionId;
  if (graphNodeSessionId) {
    return graphNodeSessionId;
  }

  if (message.roleSlotId?.trim()) {
    return architectureSessionIdForRunSlot(result.run.id, message.roleSlotId) ?? undefined;
  }
  return architectureSessionIdForRunSlot(result.run.id, message.eventId);
}

function speakerLabel(speaker: TraceSpeaker, roleSlotId: string | undefined): string {
  if (roleSlotId) {
    return roleSlotId
      .split(/[-_]/)
      .filter(Boolean)
      .map((part) => `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`)
      .join(' ');
  }
  if (speaker === 'participant') return 'Agent';
  if (speaker === 'router') return 'Router';
  return 'Finalizer';
}

function routeLine(source: string | undefined, nextNodeId: string | undefined): string | null {
  if (!nextNodeId) {
    return null;
  }
  return source ? `Route: ${source} -> ${nextNodeId}` : `Route: ${nextNodeId}`;
}

function incompleteLine(reason: string | undefined): string | null {
  return reason && reason.trim().length > 0 ? `Incomplete: ${reason.trim()}` : null;
}

function streamLine(stream: ArchitectureBranchStreamSummary | undefined): string | null {
  return stream
    ? `Stream: ${stream.status} / ${stream.chunkCount} chunks / ${stream.branchSessionId}`
    : null;
}

function isSyntheticParallelMessage(content: string): boolean {
  return /^.+ started \d+ outgoing paths?\.$/.test(content);
}
