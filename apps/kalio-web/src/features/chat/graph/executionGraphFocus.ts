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
  const architecturePromptIndexes = messages
    .map((message, index) => isArchitecturePrompt(message) ? index : -1)
    .filter((index) => index >= 0);
  const architectureRunCount = architecturePromptIndexes.length;
  const latestArchitectureRunId = findLatestArchitectureRunId(messages);

  if (mode === 'all' || architecturePromptIndexes.length < 2) {
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

function isArchitecturePrompt(message: ChatMessage): boolean {
  return message.role === 'user' && /^\[Architecture:/i.test(message.content.trim());
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
    const callRunId = call.id.match(/^architecture:([^:]+):/)?.[1];
    if (callRunId) {
      return callRunId;
    }
  }

  const toolRunId = message.toolCallId?.match(/^architecture:([^:]+):/)?.[1];
  return toolRunId ?? null;
}

function messageReferencesArchitecture(message: ChatMessage): boolean {
  return Boolean(architectureRunIdForMessage(message)) || isArchitecturePrompt(message);
}

function findPromptStartIndex(messages: ChatMessage[], latestArchitectureIndex: number): number {
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
