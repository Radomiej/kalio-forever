import type {
  ArchitectureExecutionEvent,
  ArchitectureRun,
  ArchitectureSchema,
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
  const messages: ChatMessage[] = [{
    id: `architecture:${run.id}:user`,
    sessionId: parentSessionId,
    role: 'user',
    content: run.prompt,
    createdAt: now,
  }];
  const branchEvents = events.filter((event) => (
    event.type === 'participant_output'
    && typeof event.roleSlotId === 'string'
    && !isSyntheticParallelMessage(event.message)
  ));
  const toolCalls = branchEvents.map((event) => toSubagentToolCall(schema, run, event));
  if (toolCalls.length > 0) {
    messages.push({
      id: `architecture:${run.id}:tool-calls`,
      sessionId: parentSessionId,
      role: 'assistant',
      content: '',
      toolCalls,
      createdAt: now + 1,
    });
    messages.push(...branchEvents.map((event, index) => ({
      id: `architecture:${run.id}:tool-result:${event.id}`,
      sessionId: parentSessionId,
      role: 'tool_result' as const,
      content: JSON.stringify(toSubagentToolResult(run, parentSessionId, rootSessionId, event)),
      toolCallId: `architecture:${run.id}:${event.id}`,
      createdAt: now + 2 + index,
    })));
  }

  const textEvents = events.filter((event) => (
    (event.type === 'router_decision' || event.type === 'final_artifact' || event.type === 'run_stopped')
    && !isSyntheticParallelMessage(event.message)
  ));
  messages.push(...textEvents.map((event, index) => ({
    id: `architecture:${run.id}:text:${event.id}`,
    sessionId: parentSessionId,
    role: 'assistant' as const,
    content: formatParentChatText(run, event),
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
    result: event.message,
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
  const body = stripRuntimeScaffold(event.message)
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
  return /^.+ started \d+ outgoing paths?\.$/.test(content);
}

function failureReasonFromEvent(event: ArchitectureExecutionEvent): string | null {
  if (event.type !== 'router_decision' || event.message !== 'Architecture run failed.') {
    return null;
  }
  const error = event.data?.['error'];
  if (typeof error !== 'string' || error.trim().length === 0) {
    return null;
  }
  const firstLine = error.replace(/\r\n/g, '\n').split('\n').find((line) => line.trim().length > 0)?.trim();
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
  const message = event.message.trim();
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
