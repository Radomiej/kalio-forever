/**
 * Compacting strategies for trimming chat history when approaching the context window limit.
 *
 * AutoTrimStrategy removal priority (oldest first within each tier):
 *  1. Tool messages — result + matching assistant tool_call pair
 *  2. Assistant messages without tool_call
 *  3. User messages (first user message is always preserved)
 */
import type { ChatMessage } from '@kalio/types';
import { estimateTextTokens } from './tokenCounter';

// ── Interface ──────────────────────────────────────────────────────────────────

export interface CompactStrategy {
  name: string;
  compact(messages: ChatMessage[], targetTokens: number): ChatMessage[];
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function estimateMessageTokens(msg: ChatMessage): number {
  const tokens = estimateTextTokens(msg.content);
  return tokens;
}

function totalTokens(messages: ChatMessage[]): number {
  let sum = 0;
  for (const m of messages) sum += estimateMessageTokens(m);
  return sum;
}

function removeMessagesByIds(messages: ChatMessage[], idsToRemove: Set<string>): ChatMessage[] {
  return messages.filter((message) => !idsToRemove.has(message.id));
}

function findOldestToolPair(messages: ChatMessage[], firstUserId?: string): ChatMessage[] | null {
  for (const message of messages) {
    if (message.role !== 'tool_result' || !message.toolCallId) {
      continue;
    }

    const assistant = messages.find(
      (candidate) => candidate.role === 'assistant'
        && candidate.id !== firstUserId
        && candidate.toolCalls?.some((toolCall) => toolCall.id === message.toolCallId),
    );
    if (assistant) {
      return [assistant, message];
    }
  }

  return null;
}

function findOldestStandaloneToolResult(messages: ChatMessage[], firstUserId?: string): ChatMessage | null {
  return messages.find((message) => message.role === 'tool_result' && message.id !== firstUserId) ?? null;
}

function findOldestAssistant(messages: ChatMessage[], firstUserId?: string): ChatMessage | null {
  return messages.find(
    (message) => message.role === 'assistant' && message.id !== firstUserId && !(message.toolCalls && message.toolCalls.length > 0),
  ) ?? null;
}

function findOldestNonInitialUser(messages: ChatMessage[], firstUserId?: string): ChatMessage | null {
  return messages.find((message) => message.role === 'user' && message.id !== firstUserId) ?? null;
}

// ── AutoTrimStrategy ───────────────────────────────────────────────────────────

class AutoTrimStrategy implements CompactStrategy {
  name = 'auto-trim';

  compact(messages: ChatMessage[], targetTokens: number): ChatMessage[] {
    const safeTarget = targetTokens * 0.8;
    let result = [...messages];

    if (totalTokens(result) <= safeTarget) return result;

    const firstUserId = result.find((message) => message.role === 'user')?.id;

    while (totalTokens(result) > safeTarget) {
      const toolPair = findOldestToolPair(result, firstUserId);
      if (toolPair) {
        result = removeMessagesByIds(result, new Set(toolPair.map((message) => message.id)));
        continue;
      }

      const standaloneToolResult = findOldestStandaloneToolResult(result, firstUserId);
      if (standaloneToolResult) {
        result = removeMessagesByIds(result, new Set([standaloneToolResult.id]));
        continue;
      }

      const assistant = findOldestAssistant(result, firstUserId);
      if (assistant) {
        result = removeMessagesByIds(result, new Set([assistant.id]));
        continue;
      }

      const user = findOldestNonInitialUser(result, firstUserId);
      if (user) {
        result = removeMessagesByIds(result, new Set([user.id]));
        continue;
      }

      break;
    }

    return result;
  }
}

// ── WarnOnlyStrategy ───────────────────────────────────────────────────────────

class WarnOnlyStrategy implements CompactStrategy {
  name = 'warn-only';

  compact(messages: ChatMessage[]): ChatMessage[] {
    // No trimming — just return as-is
    return messages;
  }
}

// ── Factory ────────────────────────────────────────────────────────────────────

const strategies: Record<string, CompactStrategy> = {
  'auto-trim': new AutoTrimStrategy(),
  'warn-only': new WarnOnlyStrategy(),
};

export function getCompactStrategy(name: string): CompactStrategy {
  return strategies[name] ?? strategies['warn-only'];
}
