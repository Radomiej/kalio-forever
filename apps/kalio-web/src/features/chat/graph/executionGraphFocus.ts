import type { ChatMessage } from '@kalio/types';

export type ExecutionGraphFocusMode = 'latest-architecture' | 'all';

export interface FocusedExecutionGraphMessages {
  architectureRunCount: number;
  latestArchitectureRunId: string | null;
  messages: ChatMessage[];
}

export function focusExecutionGraphMessages(
  messages: ChatMessage[],
  mode: ExecutionGraphFocusMode,
): FocusedExecutionGraphMessages {
  const architectureRunCount = architectureRunIds(messages).length;
  const latestArchitectureRunId = findLatestArchitectureRunId(messages);

  if (mode === 'all' || architectureRunCount < 2) {
    return { architectureRunCount, latestArchitectureRunId, messages };
  }

  const latestArchitectureIndex = findLatestArchitectureMessageIndex(messages);
  if (latestArchitectureIndex < 0) {
    return { architectureRunCount, latestArchitectureRunId, messages };
  }

  const startIndex = findPromptStartIndex(messages, latestArchitectureIndex);
  const endIndex = findNextUserMessageIndex(messages, startIndex + 1);
  return {
    architectureRunCount,
    latestArchitectureRunId,
    messages: messages.slice(startIndex, endIndex < 0 ? undefined : endIndex),
  };
}

function findLatestArchitectureMessageIndex(messages: ChatMessage[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messageReferencesArchitecture(messages[index])) {
      return index;
    }
  }
  return -1;
}

function findLatestArchitectureRunId(messages: ChatMessage[]): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const runId = architectureRunIdForMessage(messages[index]);
    if (runId) {
      return runId;
    }
  }
  return null;
}

function architectureRunIdForMessage(message: ChatMessage): string | null {
  if (message.architectureRun?.runId) {
    return message.architectureRun.runId;
  }

  for (const call of message.toolCalls ?? []) {
    const runId = call.args['architectureRunId'];
    if (typeof runId === 'string') {
      return runId;
    }
  }

  if (message.role === 'tool_result') {
    const parsed = parseRecord(message.content);
    const runId = parsed?.['architectureRunId'];
    if (typeof runId === 'string') {
      return runId;
    }
  }

  return null;
}

function messageReferencesArchitecture(message: ChatMessage): boolean {
  return Boolean(architectureRunIdForMessage(message));
}

function findPromptStartIndex(messages: ChatMessage[], latestArchitectureIndex: number): number {
  if (messages[latestArchitectureIndex]?.role === 'assistant') {
    for (let index = latestArchitectureIndex - 1; index >= 0; index -= 1) {
      if (messages[index]?.role === 'user') {
        return index;
      }
    }
  }
  for (let index = latestArchitectureIndex; index >= 0; index -= 1) {
    if (messages[index]?.role === 'user') {
      return index;
    }
  }
  return latestArchitectureIndex;
}

function findNextUserMessageIndex(messages: ChatMessage[], startIndex: number): number {
  for (let index = startIndex; index < messages.length; index += 1) {
    if (messages[index]?.role === 'user') {
      return index;
    }
  }
  return -1;
}

function architectureRunIds(messages: ChatMessage[]): string[] {
  const runIds = new Set<string>();
  for (const message of messages) {
    const runId = architectureRunIdForMessage(message);
    if (runId) {
      runIds.add(runId);
    }
  }
  return [...runIds];
}

function parseRecord(content: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(content);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}
