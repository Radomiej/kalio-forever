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

// ── AutoTrimStrategy ───────────────────────────────────────────────────────────

class AutoTrimStrategy implements CompactStrategy {
  name = 'auto-trim';

  compact(messages: ChatMessage[], targetTokens: number): ChatMessage[] {
    const safeTarget = targetTokens * 0.8;
    const result = [...messages];

    if (totalTokens(result) <= safeTarget) return result;

    // Tier 1: Remove oldest messages (keep the first user message)
    const firstUserIdx = result.findIndex((m) => m.role === 'user');
    if (firstUserIdx === -1) return result;

    for (let i = firstUserIdx + 1; i < result.length; i++) {
      if (totalTokens(result) <= safeTarget) break;
      result.splice(i, 1);
      i--;
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
