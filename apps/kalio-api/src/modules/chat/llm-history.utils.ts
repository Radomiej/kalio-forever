import type { ToolMeta } from '@kalio/types';
import type { ContextManagedLLMMessage } from '../../common/utils/context-managed-llm-message.util';
import { getReasoningContent } from '../../common/utils/context-managed-llm-message.util';

const CHARS_PER_TOKEN = 4;
const IMAGE_PART_TOKENS = 85;
const SAFE_CONTEXT_RATIO = 0.8;
const MAX_INLINE_STRING_CHARS = 1500;
const MAX_TOOL_RESULT_PREVIEW_CHARS = 4000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function estimateTextTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

function truncateText(text: string, maxChars = MAX_INLINE_STRING_CHARS): string {
  if (text.length <= maxChars) {
    return text;
  }

  const omittedChars = text.length - maxChars;
  return `${text.slice(0, maxChars)}...[truncated ${omittedChars} chars for context safety]`;
}

function buildInlineDataMarker(root: Record<string, unknown> | null): string {
  const segments = ['inline binary omitted'];
  if (typeof root?.['path'] === 'string' && root['path'].trim().length > 0) {
    segments.push(`path=${root['path']}`);
  }
  if (typeof root?.['download_url'] === 'string' && root['download_url'].trim().length > 0) {
    segments.push(`download_url=${root['download_url']}`);
  }
  return `[${segments.join('; ')}]`;
}

function sanitizeJsonValue(value: unknown, root: Record<string, unknown> | null): unknown {
  if (typeof value === 'string') {
    if (value.startsWith('data:')) {
      return buildInlineDataMarker(root);
    }
    return truncateText(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeJsonValue(item, root));
  }

  if (!isRecord(value)) {
    return value;
  }

  const currentRoot = root ?? value;
  const sanitized: Record<string, unknown> = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    sanitized[key] = sanitizeJsonValue(nestedValue, currentRoot);
  }
  return sanitized;
}

function estimateContentTokens(content: ContextManagedLLMMessage['content']): number {
  if (typeof content === 'string') {
    return estimateTextTokens(content);
  }

  let total = 0;
  for (const part of content) {
    if (part.type === 'text') {
      total += estimateTextTokens(part.text);
      continue;
    }

    if (part.type === 'image_url') {
      total += IMAGE_PART_TOKENS;
    }
  }
  return total;
}

function estimateMessageTokens(message: ContextManagedLLMMessage): number {
  let total = estimateContentTokens(message.content);

  total += estimateTextTokens(getReasoningContent(message));

  if ('toolCalls' in message && Array.isArray(message.toolCalls) && message.toolCalls.length > 0) {
    total += estimateTextTokens(JSON.stringify(message.toolCalls));
  }

  if ('toolCallId' in message && typeof message.toolCallId === 'string') {
    total += estimateTextTokens(message.toolCallId);
  }

  return total;
}

function estimateToolTokens(toolMetas: ToolMeta[]): number {
  if (toolMetas.length === 0) {
    return 0;
  }

  const serialized = toolMetas.map((toolMeta) => JSON.stringify(toolMeta)).join('\n');
  return estimateTextTokens(serialized);
}

function totalHistoryTokens(messages: ContextManagedLLMMessage[], toolMetas: ToolMeta[]): number {
  let total = estimateToolTokens(toolMetas);
  for (const message of messages) {
    total += estimateMessageTokens(message);
  }
  return total;
}

function removeIndexes(messages: ContextManagedLLMMessage[], indexes: Set<number>): ContextManagedLLMMessage[] {
  return messages.filter((_, index) => !indexes.has(index));
}

function findOldestToolPair(messages: ContextManagedLLMMessage[]): [number, number] | null {
  for (let toolIndex = 0; toolIndex < messages.length; toolIndex += 1) {
    const toolMessage = messages[toolIndex];
    if (toolMessage.role !== 'tool' || !('toolCallId' in toolMessage) || typeof toolMessage.toolCallId !== 'string') {
      continue;
    }

    const assistantIndex = messages.findIndex(
      (candidate) =>
        candidate.role === 'assistant' &&
        'toolCalls' in candidate &&
        Array.isArray(candidate.toolCalls) &&
        candidate.toolCalls.some((toolCall) => toolCall.id === toolMessage.toolCallId),
    );

    if (assistantIndex >= 0) {
      return [assistantIndex, toolIndex];
    }
  }

  return null;
}

function findOldestIndex(
  messages: ContextManagedLLMMessage[],
  predicate: (message: ContextManagedLLMMessage, index: number) => boolean,
): number {
  return messages.findIndex(predicate);
}

function truncateMessageContent(message: ContextManagedLLMMessage): ContextManagedLLMMessage {
  const reasoningContent = getReasoningContent(message);
  const truncatedReasoningContent = reasoningContent
    ? truncateText(reasoningContent, MAX_TOOL_RESULT_PREVIEW_CHARS)
    : undefined;

  if (typeof message.content === 'string') {
    return {
      ...message,
      ...(truncatedReasoningContent ? { reasoningContent: truncatedReasoningContent } : {}),
      content: truncateText(message.content, MAX_TOOL_RESULT_PREVIEW_CHARS),
    };
  }

  return {
    ...message,
    ...(truncatedReasoningContent ? { reasoningContent: truncatedReasoningContent } : {}),
    content: message.content.map((part) =>
      part.type === 'text'
        ? { ...part, text: truncateText(part.text, MAX_TOOL_RESULT_PREVIEW_CHARS) }
        : part,
    ),
  };
}

export function prepareHistoryForLLM(
  messages: ContextManagedLLMMessage[],
  systemPrompt: string,
  contextWindowSize: number,
  toolMetas: ToolMeta[],
): { history: ContextManagedLLMMessage[]; unboundedHistoryCount: number } {
  const unboundedHistory = systemPrompt
    ? [{ role: 'system', content: systemPrompt } satisfies ContextManagedLLMMessage, ...messages]
    : [...messages];

  return {
    history: compactLLMHistory(unboundedHistory, contextWindowSize, toolMetas),
    unboundedHistoryCount: unboundedHistory.length,
  };
}

export function sanitizeToolResultContentForLLM(content: string): string {
  if (!content) {
    return content;
  }

  try {
    const parsed = JSON.parse(content) as unknown;
    const sanitized = sanitizeJsonValue(parsed, isRecord(parsed) ? parsed : null);
    const serialized = JSON.stringify(sanitized);

    if (serialized.length <= MAX_TOOL_RESULT_PREVIEW_CHARS) {
      return serialized;
    }

    return `[tool result truncated for context safety]\n${serialized.slice(0, MAX_TOOL_RESULT_PREVIEW_CHARS)}`;
  } catch {
    return truncateText(content, MAX_TOOL_RESULT_PREVIEW_CHARS);
  }
}

export function compactLLMHistory(
  messages: ContextManagedLLMMessage[],
  contextWindowSize: number,
  toolMetas: ToolMeta[],
): ContextManagedLLMMessage[] {
  if (messages.length === 0 || contextWindowSize <= 0) {
    return messages;
  }

  const safeTarget = Math.max(256, Math.floor(contextWindowSize * SAFE_CONTEXT_RATIO));
  if (totalHistoryTokens(messages, toolMetas) <= safeTarget) {
    return messages;
  }

  const systemMessage = messages[0]?.role === 'system' ? messages[0] : null;
  let body = systemMessage ? messages.slice(1) : [...messages];

  while (body.length > 0 && totalHistoryTokens(systemMessage ? [systemMessage, ...body] : body, toolMetas) > safeTarget) {
    const toolPair = findOldestToolPair(body);
    if (toolPair) {
      body = removeIndexes(body, new Set(toolPair));
      continue;
    }

    const standaloneToolIndex = findOldestIndex(body, (message) => message.role === 'tool');
    if (standaloneToolIndex >= 0) {
      body = removeIndexes(body, new Set([standaloneToolIndex]));
      continue;
    }

    const assistantIndex = findOldestIndex(
      body,
      (message) => message.role === 'assistant' && (!('toolCalls' in message) || !Array.isArray(message.toolCalls) || message.toolCalls.length === 0),
    );
    if (assistantIndex >= 0) {
      body = removeIndexes(body, new Set([assistantIndex]));
      continue;
    }

    const firstUserIndex = findOldestIndex(body, (message) => message.role === 'user');
    const laterUserIndex = findOldestIndex(body, (message, index) => message.role === 'user' && index !== firstUserIndex);
    if (laterUserIndex >= 0) {
      body = removeIndexes(body, new Set([laterUserIndex]));
      continue;
    }

    if (firstUserIndex >= 0 && body.length > 1) {
      body = removeIndexes(body, new Set([firstUserIndex]));
      continue;
    }

    const truncationIndex = findOldestIndex(body, (message) => estimateMessageTokens(message) > 0);
    if (truncationIndex >= 0) {
      body = body.map((message, index) => (index === truncationIndex ? truncateMessageContent(message) : message));
    }
    break;
  }

  return systemMessage ? [systemMessage, ...body] : body;
}