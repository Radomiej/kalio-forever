import type { ChatMessage } from '@kalio/types';

export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail?: 'low' | 'high' | 'auto' } };

export type LLMHistoryMessage = {
  role: 'user' | 'assistant';
  content: string | ContentPart[];
};

export interface BuildHistoryOptions {
  /** When true, replace image_url parts with text placeholders (for non-vision models). */
  stripImages?: boolean;
  /** OpenAI-compatible detail level for image_url parts. Default: 'auto' */
  imageDetailMode?: 'low' | 'auto' | 'high';
}

/**
 * Converts session messages into LLM-compatible history.
 * - user/assistant text messages → passed through
 * - loading messages → skipped
 */
export function buildHistory(messages: ChatMessage[], _options?: BuildHistoryOptions): LLMHistoryMessage[] {
  const out: LLMHistoryMessage[] = [];

  for (const m of messages) {
    if (m.role === 'user' && m.content?.trim()) {
      out.push({ role: 'user', content: m.content });
      continue;
    }

    if (m.role === 'assistant' && m.content?.trim()) {
      out.push({ role: 'assistant', content: m.content });
      continue;
    }
  }

  return out;
}
