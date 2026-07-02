import type {
  ArchitectureChatRunSummary,
  ArchitectureExecutionEvent,
  ArchitectureRun,
  ArchitectureSchema,
  ArchitectureBranchStreamSummary,
  ChatMessage,
  LLMToolCall,
  SubagentToolResult,
} from '@kalio/types';

export function buildArchitectureParentChatMessages(
  schema: ArchitectureSchema,
  run: ArchitectureRun,
  parentSessionId: string,
  events: ArchitectureExecutionEvent[],
  now: number,
): ChatMessage[] {
  const rootSessionId = run.rootSessionId ?? parentSessionId;
  const turnId = `architecture-turn-${run.id}`;
  const promptMessageId = `architecture:${run.id}:user`;
  const messages: ChatMessage[] = [{
    id: promptMessageId,
    sessionId: parentSessionId,
    role: 'user',
    content: run.prompt,
    turnId,
    promptMessageId,
    createdAt: now,
  }];
  const branchEvents = events.filter((event) => (
    event.type === 'participant_output'
    && typeof event.roleSlotId === 'string'
    && !isSyntheticParallelMessage(eventMessage(event))
  ));
  const textEvents = events.filter((event) => (
    (event.type === 'router_decision' || event.type === 'final_artifact' || event.type === 'run_stopped')
    && !isSyntheticParallelMessage(eventMessage(event))
  ));
  const architectureRun = buildArchitectureChatRunSummary(schema, run, events);
  const toolCalls = branchEvents.map((event) => toSubagentToolCall(schema, run, event));
  if (toolCalls.length > 0) {
    messages.push({
      id: `architecture:${run.id}:tool-calls`,
      sessionId: parentSessionId,
      role: 'assistant',
      content: '',
      toolCalls,
      turnId,
      promptMessageId,
      architectureRun: textEvents.length === 0 ? architectureRun : undefined,
      createdAt: now + 1,
    });
    messages.push(...branchEvents.map((event, index) => ({
      id: `architecture:${run.id}:tool-result:${event.id}`,
      sessionId: parentSessionId,
      role: 'tool_result' as const,
      content: JSON.stringify(toSubagentToolResult(run, parentSessionId, rootSessionId, event)),
      toolCallId: `architecture:${run.id}:${event.id}`,
      turnId,
      promptMessageId,
      createdAt: now + 2 + index,
    })));
  }

  messages.push(...textEvents.map((event, index) => ({
    id: `architecture:${run.id}:text:${event.id}`,
    sessionId: parentSessionId,
    role: 'assistant' as const,
    content: formatParentChatText(run, event),
    turnId,
    promptMessageId,
    architectureRun: index === textEvents.length - 1 ? architectureRun : undefined,
    createdAt: now + 2 + toolCalls.length + index,
  })));
  return messages;
}

function toSubagentToolCall(schema: ArchitectureSchema, run: ArchitectureRun, event: ArchitectureExecutionEvent): LLMToolCall {
  return {
    id: `architecture:${run.id}:${event.id}`,
    name: 'run_subagent',
    args: {
      objective: `${speakerLabel(event.roleSlotId)} branch for: ${run.prompt}`,
      architectureRunId: run.id,
      schemaName: schema.name,
      nodeId: event.nodeId,
      roleSlotId: event.roleSlotId,
      childSessionId: branchSessionId(run, event),
    },
  };
}

function toSubagentToolResult(
  run: ArchitectureRun,
  parentSessionId: string,
  rootSessionId: string,
  event: ArchitectureExecutionEvent,
): SubagentToolResult {
  return {
    result: eventMessage(event),
    taskId: event.id,
    childSessionId: branchSessionId(run, event),
    parentSessionId,
    vfsMode: 'shared',
    vfsSessionId: rootSessionId,
    copiedFiles: [],
    durationMs: 0,
  };
}

function branchSessionId(run: ArchitectureRun, event: ArchitectureExecutionEvent): string {
  const stream = streamFromEventData(event.data);
  if (stream) {
    return stream;
  }
  if (event.roleSlotId && run.branchSessionIds?.[event.roleSlotId]) {
    return run.branchSessionIds[event.roleSlotId];
  }
  return run.rootSessionId ?? event.runId;
}

function streamFromEventData(data: Record<string, unknown> | undefined): string | null {
  const stream = data?.['stream'];
  if (!isPlainRecord(stream)) {
    return null;
  }
  const branchSessionId = stream['branchSessionId'];
  return typeof branchSessionId === 'string' ? branchSessionId : null;
}

function streamSummaryFromEventData(data: Record<string, unknown> | undefined): ArchitectureBranchStreamSummary | undefined {
  const stream = data?.['stream'];
  if (!isPlainRecord(stream)) {
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
    || (status !== 'started' && status !== 'streaming' && status !== 'completed' && status !== 'failed')
    || typeof chunkCount !== 'number'
    || typeof text !== 'string'
  ) {
    return undefined;
  }
  return { streamGroupId, branchSessionId, status, chunkCount, text };
}

function buildArchitectureChatRunSummary(
  schema: ArchitectureSchema,
  run: ArchitectureRun,
  events: ArchitectureExecutionEvent[],
): ArchitectureChatRunSummary {
  return {
    runId: run.id,
    schemaId: schema.id,
    status: run.status,
    hostProjectionKind: 'workflow-envelope',
    finalArtifact: finalArtifactFromEvents(events),
    trace: events
      .filter((event) => !isSyntheticParallelMessage(eventMessage(event)))
      .filter((event) => (
        event.type === 'participant_output'
        || event.type === 'router_decision'
        || event.type === 'final_artifact'
        || event.type === 'run_stopped'
      ))
      .map((event) => ({
        speaker: traceSpeakerForEvent(event),
        content: stripRuntimeScaffold(eventMessage(event)),
        eventId: event.id,
        nodeId: event.nodeId,
        nextNodeId: event.route?.nextNodeId,
        reasonCode: event.reasonCode,
        errorCode: event.errorCode,
        failure: event.failure,
        evidence: event.evidence,
        runtimeDecision: event.runtimeDecision,
        stream: event.type === 'participant_output' ? streamSummaryFromEventData(event.data) : undefined,
      })),
    routeHops: [],
  };
}

function traceSpeakerForEvent(event: ArchitectureExecutionEvent): ArchitectureChatRunSummary['trace'][number]['speaker'] {
  if (event.type === 'participant_output') {
    return 'participant';
  }
  if (event.type === 'final_artifact') {
    return 'finalizer';
  }
  return 'router';
}

function finalArtifactFromEvents(events: ArchitectureExecutionEvent[]): string | undefined {
  const finalArtifact = [...events]
    .reverse()
    .find((event) => event.type === 'final_artifact' && eventMessage(event).trim().length > 0);
  return finalArtifact ? stripRuntimeScaffold(eventMessage(finalArtifact)) || eventMessage(finalArtifact).trim() : undefined;
}

function formatParentChatText(run: ArchitectureRun, event: ArchitectureExecutionEvent): string {
  if (event.type === 'run_stopped') {
    return formatRunStoppedText(run, event);
  }
  const header = event.type === 'final_artifact' ? '### Finalizer' : '### Router';
  const route = event.route?.nextNodeId
    ? `Route: ${event.route.source} -> ${event.route.nextNodeId}`
    : null;
  const failureReason = failureReasonFromEvent(event);
  const incompleteReason = incompleteReasonFromEvent(event);
  const body = stripRuntimeScaffold(eventMessage(event))
    || (event.type === 'final_artifact'
      ? 'Final answer produced from the routed graph outputs.'
      : 'Router completed synthesis for the next graph node.');
  return [
    header,
    route,
    incompleteReason ? `Incomplete: ${incompleteReason}` : null,
    body,
    failureReason ? `Reason: ${failureReason}` : null,
  ].filter(Boolean).join('\n\n');
}

function formatRunStoppedText(run: ArchitectureRun, event: ArchitectureExecutionEvent): string {
  const reason = runStoppedReasonFromEvent(event);
  const reasonCode = runStoppedReasonCodeFromEvent(event);
  return [
    '### Run stopped',
    `Status: ${run.status}`,
    reason ? `Reason: ${reason}` : null,
    reasonCode ? `Reason code: ${reasonCode}` : null,
  ].filter(Boolean).join('\n\n');
}

function eventMessage(event: ArchitectureExecutionEvent): string {
  return typeof event.message === 'string' ? event.message : '';
}

function speakerLabel(roleSlotId: string | undefined): string {
  return roleSlotId
    ? roleSlotId.split(/[-_]/).filter(Boolean).map((part) => `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`).join(' ')
    : 'Agent';
}

function stripRuntimeScaffold(content: string): string {
  const lines = content.replace(/^\[MockLLM\]\s*Echo:\s*/i, '').replace(/\r\n/g, '\n').split('\n');
  const kept: string[] = [];
  let skippingIncoming = false;
  let skipNextAvailableNodeLine = false;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      if (kept.length > 0 && kept.at(-1) !== '') kept.push('');
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
    if (skippingIncoming || isRuntimeScaffoldLine(line)) {
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
    || /^[-\w]+:\s+.*(?:started|completed|agent started|\[MockLLM\])/i.test(line)
    || /^Return a concise role-specific contribution/i.test(line)
    || /^Act as a graph router\./i.test(line)
    || /^Produce the final user-facing answer/i.test(line);
}

function isSyntheticParallelMessage(content: string): boolean {
  return /^.+ started \d+ outgoing paths?\.$/.test(content)
    || /^.+ fanned out to .+\.$/.test(content);
}

function failureReasonFromEvent(event: ArchitectureExecutionEvent): string | null {
  if (event.type !== 'router_decision') {
    return null;
  }
  const error = workflowFailureMessage(event.failure)
    ?? workflowFailureMessage(event.data?.failure)
    // TODO: legacy fallback - older persisted router failure events stored only data.error.
    ?? stringValue(event.data?.['error']);
  const firstLine = firstNonEmptyLine(error);
  if (!firstLine) {
    return null;
  }
  return firstLine.length > 240 ? `${firstLine.slice(0, 237)}...` : firstLine;
}

function incompleteReasonFromEvent(event: ArchitectureExecutionEvent): string | null {
  const reason = event.data?.['incompleteReason'];
  if (typeof reason !== 'string' || reason.trim().length === 0) {
    return null;
  }
  return reason.trim();
}

function runStoppedReasonFromEvent(event: ArchitectureExecutionEvent): string | null {
  const reason = event.data?.['reason'];
  if (typeof reason === 'string' && reason.trim().length > 0) {
    return reason.trim();
  }
  const message = eventMessage(event).trim();
  return message.length > 0 ? message : null;
}

function runStoppedReasonCodeFromEvent(event: ArchitectureExecutionEvent): string | null {
  const reasonCode = event.data?.['reasonCode'];
  if (typeof reasonCode === 'string' && reasonCode.trim().length > 0) {
    return reasonCode.trim();
  }
  return null;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function workflowFailureMessage(value: unknown): string | null {
  if (!isPlainRecord(value)) {
    return null;
  }
  return stringValue(value['message']);
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function firstNonEmptyLine(value: string | null): string | null {
  return value?.replace(/\r\n/g, '\n').split('\n').find((line) => line.trim().length > 0)?.trim() ?? null;
}
