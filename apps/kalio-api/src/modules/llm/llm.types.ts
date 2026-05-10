/**
 * Shared LLM interfaces used by both llm.service.ts and the provider layer.
 * Keeping these in a dedicated file breaks the circular dependency:
 *   llm.service.ts ↔ providers/provider-factory.ts ↔ providers/*.ts
 */
import type { LLMMessage, LLMStreamChunk, LLMToolCall } from '@kalio/types';

/** Contract every LLM text-completion provider must implement. */
export interface ILLMProvider {
  streamChat(
    messages: LLMMessage[],
    tools: Array<{ name: string; description: string; parameters: Record<string, unknown> }>,
    onChunk: (chunk: LLMStreamChunk) => void,
    sessionId: string,
    messageId: string,
    abortSignal?: AbortSignal,
  ): Promise<LLMToolCall[]>;
}

/** Runtime config passed to provider factories. */
export interface ProviderConfig {
  provider: string;
  apiKey: string;
  model: string;
  baseUrl?: string;
}
