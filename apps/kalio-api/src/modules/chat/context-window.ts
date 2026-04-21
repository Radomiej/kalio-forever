import type { LLMMessage } from '@kalio/types';

/**
 * Rough token estimator: ~4 chars per token (GPT-style).
 * Fast enough for real-time trimming without a tokenizer library.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Trim a chat history to fit within maxTokens using the "auto-trim" strategy:
 * 1. Always keep the system prompt (index 0)
 * 2. Always keep the last (most recent) user message
 * 3. Remove oldest non-system messages until the total fits
 *
 * Returns the trimmed history. If the history already fits, returns it unchanged.
 */
export function trimToContextWindow(history: LLMMessage[], maxTokens: number): LLMMessage[] {
  if (history.length <= 1) return history;

  const system = history[0]!;
  const rest = history.slice(1);

  // Count tokens for all messages
  const sysTokens = estimateTokens(system.content);
  const msgTokens = rest.map((m) => estimateTokens(m.content));
  const totalTokens = sysTokens + msgTokens.reduce((a, b) => a + b, 0);

  if (totalTokens <= maxTokens) return history;

  // Reserve budget for the trim notice we'll insert
  const NOTICE_RESERVE = 20;
  let budget = maxTokens - sysTokens - NOTICE_RESERVE;

  // Walk from newest to oldest, keep messages that fit
  const kept: LLMMessage[] = [];
  for (let i = rest.length - 1; i >= 0; i--) {
    const tokens = msgTokens[i]!;
    if (budget - tokens >= 0) {
      budget -= tokens;
      kept.unshift(rest[i]!);
    }
    // Skip (drop) messages that don't fit
  }

  const dropped = rest.length - kept.length;
  if (dropped > 0) {
    // Insert a synthetic note so the model knows history was trimmed
    kept.unshift({
      role: 'system',
      content: `[${dropped} older message(s) removed to fit context window]`,
    });
  }

  return [system, ...kept];
}
