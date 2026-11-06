import type { ChatMessage } from '@kalio/types';
import { findArchitectureRunInMessages } from './architectureChatSummary';
import { extractSubAgentFlowResult } from './subAgentFlowResult.parser';

export type ArchitectureRunSummary = NonNullable<ReturnType<typeof findArchitectureRunInMessages>>;

/** Durable parent-projection prompt identity, including runs that failed before emitting tools. */
export function projectedArchitecturePromptRunId(message: ChatMessage): string | undefined {
  if (message.role !== 'user') return undefined;
  const runId = /^architecture:([A-Za-z0-9_-]{1,80}):user$/.exec(message.id)?.[1];
  return runId && message.turnId === `architecture-turn-${runId}` ? runId : undefined;
}

function buildReloadedArchitectureSummaryMessage(
  sessionId: string,
  messages: ChatMessage[],
  summary: ArchitectureRunSummary,
): ChatMessage {
  const turnId = `architecture-turn-${summary.runId}`;
  const fallbackPromptMessageId = `architecture:${summary.runId}:user`;
  const promptMessageId = promptMessageIdForArchitectureRun(messages, summary.runId)
    ?? fallbackPromptMessageId;
  const relatedMessages = messages.filter((message) => (
    message.architectureRun?.runId === summary.runId
    || message.turnId === turnId
    || message.id === promptMessageId
    || message.promptMessageId === promptMessageId
  ));
  const timestampMessages = relatedMessages.length > 0 ? relatedMessages : messages;
  const firstAssistantAt = timestampMessages
    .filter((message) => message.role === 'assistant')
    .map((message) => message.createdAt)
    .sort((left, right) => left - right)[0];
  const lastUserAt = [...timestampMessages]
    .reverse()
    .find((message) => message.role === 'user')
    ?.createdAt ?? Date.now();

  return {
    id: `architecture-rehydrate:${sessionId}:${summary.runId}`,
    sessionId,
    role: 'assistant',
    content: '',
    turnId,
    promptMessageId,
    architectureRun: {
      ...summary,
      finalArtifact: undefined,
    },
    createdAt: typeof firstAssistantAt === 'number' ? Math.max(0, firstAssistantAt - 1) : lastUserAt + 1,
  };
}

function promptMessageIdForArchitectureRun(messages: ChatMessage[], runId: string): string | null {
  for (const message of messages) {
    if (
      (message.architectureRun?.runId === runId || projectedArchitecturePromptRunId(message) === runId)
      && typeof message.promptMessageId === 'string'
      && message.promptMessageId.trim().length > 0
    ) {
      return message.promptMessageId;
    }
    if (
      message.toolCalls?.some((toolCall) => toolCall.args['architectureRunId'] === runId) === true
      && typeof message.promptMessageId === 'string'
      && message.promptMessageId.trim().length > 0
    ) {
      return message.promptMessageId;
    }
  }
  const subAgentFlowCallId = subAgentFlowCallIdForArchitectureRun(messages, runId);
  if (subAgentFlowCallId) {
    const toolCallMessage = messages.find((message) => (
      message.role === 'assistant'
      && message.toolCalls?.some((toolCall) => toolCall.id === subAgentFlowCallId) === true
    ));
    if (
      toolCallMessage
      && typeof toolCallMessage.promptMessageId === 'string'
      && toolCallMessage.promptMessageId.trim().length > 0
    ) {
      return toolCallMessage.promptMessageId;
    }
    const toolCallCreatedAt = toolCallMessage?.createdAt;
    return [...messages]
      .filter((message) => (
        message.role === 'user'
        && (typeof toolCallCreatedAt !== 'number' || message.createdAt <= toolCallCreatedAt)
      ))
      .at(-1)
      ?.id ?? null;
  }
  return null;
}

function subAgentFlowCallIdForArchitectureRun(messages: ChatMessage[], runId: string): string | null {
  const subAgentFlowCallIds = new Set(messages
    .filter((message) => message.role === 'assistant' && message.toolCalls)
    .flatMap((message) => message.toolCalls ?? [])
    .filter((toolCall) => toolCall.name === 'run_sub_agentflow')
    .map((toolCall) => toolCall.id));

  for (const message of messages) {
    if (
      message.role !== 'tool_result'
      || typeof message.toolCallId !== 'string'
      || !subAgentFlowCallIds.has(message.toolCallId)
    ) {
      continue;
    }
    const result = extractSubAgentFlowResult(parseToolResultContent(message.content));
    if (result?.openGraphRunId === runId) {
      return message.toolCallId;
    }
  }
  return null;
}

export function architectureRunIdsFromSubAgentFlowResults(messages: ChatMessage[]): string[] {
  const subAgentFlowCallIds = new Set(messages
    .filter((message) => message.role === 'assistant' && message.toolCalls)
    .flatMap((message) => message.toolCalls ?? [])
    .filter((toolCall) => toolCall.name === 'run_sub_agentflow')
    .map((toolCall) => toolCall.id));
  const runIds: string[] = [];

  for (const message of messages) {
    if (
      message.role !== 'tool_result'
      || typeof message.toolCallId !== 'string'
      || !subAgentFlowCallIds.has(message.toolCallId)
    ) {
      continue;
    }
    const result = extractSubAgentFlowResult(parseToolResultContent(message.content));
    const runId = result?.openGraphRunId?.trim();
    if (runId && !runIds.includes(runId)) {
      runIds.push(runId);
    }
  }
  return runIds;
}

function parseToolResultContent(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

export function mergeReloadedArchitectureSummaryMessage(
  sessionId: string,
  messages: ChatMessage[],
  summary: ArchitectureRunSummary,
): ChatMessage[] {
  const syntheticMessage = buildReloadedArchitectureSummaryMessage(sessionId, messages, summary);
  const withoutPreviousSummary = messages.filter((message) => (
    message.id !== syntheticMessage.id
    && message.architectureRun?.runId !== summary.runId
  ));
  return [...withoutPreviousSummary, syntheticMessage].sort((left, right) => left.createdAt - right.createdAt);
}

export function mergeReloadedArchitectureSummaryMessages(
  sessionId: string,
  messages: ChatMessage[],
  summaries: ArchitectureRunSummary[],
): ChatMessage[] {
  return summaries.reduce(
    (nextMessages, summary) => mergeReloadedArchitectureSummaryMessage(sessionId, nextMessages, summary),
    messages,
  );
}

function persistedArchitectureRunInMessages(
  messages: ChatMessage[],
): ArchitectureRunSummary | null {
  return persistedArchitectureRunsInMessages(messages).at(-1) ?? null;
}

function persistedArchitectureRunsInMessages(messages: ChatMessage[]): ArchitectureRunSummary[] {
  const summariesByRunId = new Map<string, ArchitectureRunSummary>();
  for (const message of messages) {
    const summary = message.architectureRun;
    if (summary) {
      summariesByRunId.set(summary.runId, summary);
    }
  }
  return [...summariesByRunId.values()];
}

export function hasUsableArchitectureRunSummary(messages: ChatMessage[]): boolean {
  const summary = persistedArchitectureRunInMessages(messages);
  return summary ? isUsablePersistedArchitectureSummary(summary) : false;
}

function isUsablePersistedArchitectureSummary(
  summary: ArchitectureRunSummary,
): boolean {
  const graphNodes = (summary as { graphNodes?: unknown }).graphNodes;
  return summary.hostProjectionKind === 'workflow-envelope'
    && Array.isArray(graphNodes);
}

export function architectureRunSummariesFromMessages(messages: ChatMessage[]): ArchitectureRunSummary[] {
  const persisted = new Map(persistedArchitectureRunsInMessages(messages).map(summary => [summary.runId, summary]));
  const runIds = new Set<string>();
  for (const message of messages) {
    if (message.architectureRun) runIds.add(message.architectureRun.runId);
    for (const call of message.toolCalls ?? []) {
      const runId = call.args['architectureRunId'];
      if (call.name === 'run_subagent' && typeof runId === 'string' && runId.trim().length > 0) runIds.add(runId);
    }
  }
  const summaries: ArchitectureRunSummary[] = [];
  for (const runId of runIds) {
    const existing = persisted.get(runId);
    if (existing) { summaries.push(existing); continue; }
    const calls = messages.flatMap(message => message.toolCalls ?? [])
      .filter(call => call.name === 'run_subagent' && call.args['architectureRunId'] === runId);
    const callIds = new Set(calls.map(call => call.id));
    const scoped = messages.flatMap((message): ChatMessage[] => {
      if (message.role === 'assistant' && message.toolCalls) {
        const toolCalls = message.toolCalls.filter(call => call.name === 'run_subagent' && call.args['architectureRunId'] === runId);
        return toolCalls.length > 0 ? [{ ...message, toolCalls }] : [];
      }
      return message.role === 'tool_result' && message.toolCallId && callIds.has(message.toolCallId) ? [message] : [];
    });
    const summary = findArchitectureRunInMessages(scoped);
    if (summary) summaries.push(summary);
  }
  return summaries;
}
