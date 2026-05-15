/**
 * Shared LLM interfaces used by both llm.service.ts and the provider layer.
 * Keeping these in a dedicated file breaks the circular dependency:
 *   llm.service.ts ↔ providers/provider-factory.ts ↔ providers/*.ts
 */
import type { LLMStreamChunk, LLMToolCall } from '@kalio/types';
import type { ContextManagedLLMMessage } from '../../common/utils/context-managed-llm-message.util';

/** Contract every LLM text-completion provider must implement. */
export interface ILLMProvider {
  streamChat(
    messages: ContextManagedLLMMessage[],
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
