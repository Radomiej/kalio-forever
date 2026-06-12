import type {
  ArchitectureBranchStreamSummary,
  ArchitectureChatRunSummary,
  ArchitectureRouterInsight,
  ArchitectureRouterOutput,
  ArchitectureRouterRisk,
  ChatMessage,
  LLMToolCall,
  SubagentToolResult,
} from '@kalio/types';
import type { AgentTurnItem } from '../../store/sessionStore';
import type { ArchitectRunResult } from '../architect/architect.types';

type TraceSpeaker = ArchitectureChatRunSummary['trace'][number]['speaker'];
type ArchitectureRunChatMessage = ArchitectRunResult['chat']['messages'][number] & { speaker: TraceSpeaker };
type ArchitectureGraphProjectionWithSchema = ArchitectRunResult['graph'] & {
  schemaName?: string;
};

export type ArchitectureChatTurnDraft = {
  content: string;
  attachRunMetadata: boolean;
};

export type ArchitectureRunTurnProjection = {
  messages: ChatMessage[];
  turnItems: AgentTurnItem[];
};

function isTraceSpeaker(value: string): value is TraceSpeaker {
  return value === 'participant' || value === 'router' || value === 'finalizer';
}

function formatRouteLabel(source: string, fromNodeId: string, toNodeId: string): string {
  return `${source}: ${fromNodeId} -> ${toNodeId}`;
}

export function buildArchitectureRunMetadata(result: ArchitectRunResult): ArchitectureChatRunSummary {
  const schemaLabel = resolveArchitectureSchemaLabel(result);
  const visitIndexByEventId = buildVisitIndexByEventId(result);
  const streamByEventId = buildStreamByEventId(result);
  const routerOutputByEventId = buildRouterOutputByEventId(result);
  const incompleteReasonByEventId = buildIncompleteReasonByEventId(result);
  const trace = result.chat.messages
    .filter((message): message is typeof message & { speaker: TraceSpeaker } => isTraceSpeaker(message.speaker))
    .map((message) => ({
      speaker: message.speaker,
      content: compactArchitectureTraceContent(message.content, message.speaker),
      eventId: message.eventId,
      nodeId: message.route?.fromNodeId,
      nextNodeId: message.route?.nextNodeId,
      visitIndex: visitIndexByEventId.get(message.eventId),
      incompleteReason: message.incompleteReason ?? incompleteReasonByEventId.get(message.eventId),
      routerOutput: sanitizeRouterOutput(routerOutputByEventId.get(message.eventId)),
      stream: streamByEventId.get(message.eventId) ?? fallbackStreamForMessage(result, message),
    }));
  return {
    runId: result.run.id,
    schemaId: schemaLabel,
    status: result.run.status,
    finalArtifact: [...result.chat.messages]
      .reverse()
      .find((message) => message.speaker === 'finalizer')
      ? compactArchitectureTraceContent(
          [...result.chat.messages].reverse().find((message) => message.speaker === 'finalizer')?.content ?? '',
          'finalizer',
        )
      : undefined,
    trace,
    routeHops: result.graph.routeHops ?? [],
  };
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
    : messages
      .find((message) => message.role === 'user')
      ?.content.match(/\[Architecture:\s*([^\]]+)\]/)?.[1]
      ?? 'architecture-run';
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

  const textTrace = messages
    .filter((message) => message.role === 'assistant' && message.content.trim().length > 0)
    .map((message): ArchitectureChatRunSummary['trace'][number] | null => {
      if (/^###\s+Router\b/im.test(message.content)) {
        return {
          speaker: 'router',
          content: message.content,
          eventId: message.id,
          nodeId: 'router',
          nextNodeId: 'final-artifact',
          incompleteReason: incompleteReasonFromContent(message.content),
        };
      }
      if (/^###\s+Finalizer\b/im.test(message.content)) {
        return {
          speaker: 'finalizer',
          content: message.content,
          eventId: message.id,
          nodeId: 'final-artifact',
          incompleteReason: incompleteReasonFromContent(message.content),
        };
      }
      return null;
    })
    .filter((step): step is ArchitectureChatRunSummary['trace'][number] => step !== null);

  return {
    runId,
    schemaId: schemaLabel,
    status: 'completed',
    finalArtifact: [...textTrace].reverse().find((step) => step.speaker === 'finalizer')?.content,
    trace: [...participantTrace, ...textTrace].sort(compareTraceByArchitectureEvent),
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

function parseSubagentToolResult(content: string): SubagentToolResult | null {
  try {
    const parsed = JSON.parse(content);
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }
    const candidate = parsed as Record<string, unknown>;
    if (
      typeof candidate['result'] !== 'string'
      || typeof candidate['taskId'] !== 'string'
      || typeof candidate['childSessionId'] !== 'string'
      || typeof candidate['parentSessionId'] !== 'string'
      || (candidate['vfsMode'] !== 'shared' && candidate['vfsMode'] !== 'isolated')
      || typeof candidate['vfsSessionId'] !== 'string'
      || !Array.isArray(candidate['copiedFiles'])
      || typeof candidate['durationMs'] !== 'number'
    ) {
      return null;
    }
    return candidate as unknown as SubagentToolResult;
  } catch {
    return null;
  }
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

function sanitizeRouterOutput(output: ArchitectureRouterOutput | undefined): ArchitectureRouterOutput | undefined {
  if (!output) {
    return undefined;
  }
  return {
    ...output,
    selectedStrategy: compactRouterField(output.selectedStrategy),
    mergedDecision: compactRouterField(output.mergedDecision),
    acceptedInputs: output.acceptedInputs.map(sanitizeRouterInsight),
    rejectedInputs: output.rejectedInputs.map(sanitizeRouterInsight),
    unresolvedConflicts: output.unresolvedConflicts.map(compactRouterField).filter(Boolean),
    risks: output.risks.map(sanitizeRouterRisk),
  };
}

function sanitizeRouterInsight(input: ArchitectureRouterInsight): ArchitectureRouterInsight {
  return {
    ...input,
    insight: compactRouterField(input.insight),
    whyAccepted: input.whyAccepted ? compactRouterField(input.whyAccepted) : undefined,
    whyRejected: input.whyRejected ? compactRouterField(input.whyRejected) : undefined,
  };
}

function sanitizeRouterRisk(risk: ArchitectureRouterRisk): ArchitectureRouterRisk {
  return {
    ...risk,
    risk: compactRouterField(risk.risk),
    mitigation: compactRouterField(risk.mitigation),
  };
}

function compactRouterField(value: string): string {
  return compactArchitectureTraceContent(value, 'router');
}

function resolveArchitectureSchemaLabel(result: ArchitectRunResult): string {
  const graphWithSchema = result.graph as ArchitectureGraphProjectionWithSchema;
  if (typeof graphWithSchema.schemaName === 'string' && graphWithSchema.schemaName.trim().length > 0) {
    return graphWithSchema.schemaName.trim();
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

  const toolCalls = branchMessages.map((message) => toSubagentToolCall(result, message, streamByEventId.get(message.eventId)));
  if (toolCalls.length > 0) {
    messages.push({
      id: `architecture:${result.run.id}:tool-calls`,
      sessionId,
      role: 'assistant',
      content: '',
      toolCalls,
      createdAt: now,
    });
    turnItems.push(...toolCalls.map((call) => ({ kind: 'tool' as const, callId: call.id })));
    branchMessages.forEach((message, index) => {
      messages.push({
        id: `architecture:${result.run.id}:tool-result:${message.eventId}`,
        sessionId,
        role: 'tool_result',
        content: JSON.stringify(toSubagentToolResult(result, sessionId, message, streamByEventId.get(message.eventId))),
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

  return { messages, turnItems };
}

function toSubagentToolCall(
  result: ArchitectRunResult,
  message: ArchitectureRunChatMessage,
  stream: ArchitectureBranchStreamSummary | undefined,
): LLMToolCall {
  const schemaLabel = resolveArchitectureSchemaLabel(result);
  return {
    id: `architecture:${result.run.id}:${message.eventId}`,
    name: 'run_subagent',
    args: {
      objective: `${speakerLabel(message.speaker, message.roleSlotId)} branch for: ${result.run.prompt}`,
      architectureRunId: result.run.id,
      schemaName: schemaLabel,
      nodeId: message.route?.fromNodeId,
      roleSlotId: message.roleSlotId,
      childSessionId: stream?.branchSessionId ?? fallbackChildSessionId(result, message),
    },
  };
}

function toSubagentToolResult(
  result: ArchitectRunResult,
  parentSessionId: string,
  message: ArchitectureRunChatMessage,
  stream: ArchitectureBranchStreamSummary | undefined,
): SubagentToolResult {
  return {
    result: message.content,
    taskId: message.eventId,
    childSessionId: stream?.branchSessionId ?? fallbackChildSessionId(result, message),
    parentSessionId,
    vfsMode: 'shared',
    vfsSessionId: result.run.rootSessionId ?? parentSessionId,
    copiedFiles: [],
    durationMs: 0,
  };
}

function fallbackStreamForMessage(
  result: ArchitectRunResult,
  message: ArchitectureRunChatMessage,
): ArchitectureBranchStreamSummary | undefined {
  if (message.speaker !== 'participant') {
    return undefined;
  }
  return {
    streamGroupId: `architecture:${result.run.id}:${message.route?.fromNodeId ?? message.eventId}`,
    branchSessionId: fallbackChildSessionId(result, message),
    status: 'completed',
    chunkCount: 0,
    text: compactArchitectureTraceContent(message.content, message.speaker),
  };
}

function fallbackChildSessionId(result: ArchitectRunResult, message: ArchitectureRunChatMessage): string {
  return `arch-${result.run.id}-${message.roleSlotId ?? message.eventId}`;
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

function incompleteReasonFromContent(content: string): string | undefined {
  const match = /^Incomplete:\s*(.+)$/im.exec(content);
  return match?.[1]?.trim();
}

function streamLine(stream: ArchitectureBranchStreamSummary | undefined): string | null {
  return stream
    ? `Stream: ${stream.status} / ${stream.chunkCount} chunks / ${stream.branchSessionId}`
    : null;
}

export function compactArchitectureTraceContent(content: string, speaker: TraceSpeaker): string {
  const cleaned = stripRuntimeScaffold(content);
  if (cleaned) {
    return cleaned;
  }
  if (speaker === 'router') {
    return 'Router completed synthesis for the next graph node.';
  }
  if (speaker === 'finalizer') {
    return 'Final answer produced from the routed graph outputs.';
  }
  return 'Branch completed its role-specific response.';
}

function stripRuntimeScaffold(content: string): string {
  const normalized = content
    .replace(/^\[MockLLM\]\s*Echo:\s*/i, '')
    .replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, ' ')
    .replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  const kept: string[] = [];
  let skippingIncoming = false;
  let skipNextAvailableNodeLine = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      if (kept.length > 0 && kept.at(-1) !== '') {
        kept.push('');
      }
      continue;
    }

    if (/^Incoming graph outputs:?$/i.test(line)) {
      skippingIncoming = true;
      continue;
    }
    if (/^Available next nodes:/i.test(line)) {
      skippingIncoming = false;
      skipNextAvailableNodeLine = true;
      continue;
    }
    if (skipNextAvailableNodeLine) {
      skipNextAvailableNodeLine = false;
      continue;
    }
    if (skippingIncoming) {
      continue;
    }
    if (isRuntimeScaffoldLine(line)) {
      continue;
    }
    kept.push(rawLine.trimEnd());
  }

  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function isRuntimeScaffoldLine(line: string): boolean {
  return /^Architecture:/i.test(line)
    || /^Slot:/i.test(line)
    || /^Node:/i.test(line)
    || /^Task:/i.test(line)
    || /^-\s*[-\w]+:\s+\[MockLLM\]/i.test(line)
    || /^[-\w]+:\s+.*(?:started|completed|agent started|\[MockLLM\])/i.test(line)
    || /^Return a concise role-specific contribution/i.test(line)
    || /^Act as a graph router\./i.test(line)
    || /^Produce the final user-facing answer/i.test(line);
}

function streamFromEventData(data: Record<string, unknown> | undefined): ArchitectureBranchStreamSummary | undefined {
  const stream = data?.['stream'];
  if (!isRecord(stream)) {
    return undefined;
  }
  const streamGroupId = stream['streamGroupId'];
  const branchSessionId = stream['branchSessionId'];
  const status = stream['status'];
  const chunkCount = stream['chunkCount'];
  const text = stream['text'];
  if (
    typeof streamGroupId !== 'string'
    || typeof branchSessionId !== 'string'
    || !isStreamStatus(status)
    || typeof chunkCount !== 'number'
    || typeof text !== 'string'
  ) {
    return undefined;
  }
  return {
    streamGroupId,
    branchSessionId,
    status,
    chunkCount,
    text,
  };
}

function isSyntheticParallelMessage(content: string): boolean {
  return /^.+ started \d+ outgoing paths?\.$/.test(content);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStreamStatus(value: unknown): value is ArchitectureBranchStreamSummary['status'] {
  return value === 'started' || value === 'streaming' || value === 'completed' || value === 'failed';
}
