/**
 * Shared LLM interfaces used by both llm.service.ts and the provider layer.
 * Keeping these in a dedicated file breaks the circular dependency:
 *   llm.service.ts ↔ providers/provider-factory.ts ↔ providers/*.ts
 */
import type { LLMStreamChunk, LLMToolCall } from '@kalio/types';
import type { ContextManagedLLMMessage } from '../../common/utils/context-managed-llm-message.util';

/** Single tool definition passed to the LLM. */
export type LLMToolDef = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

/** Per-request options for a streaming chat call. */
export interface StreamChatOptions {
  sessionId: string;
  messageId: string;
  /** Called for every streamed text/tool chunk from the provider. */
  onChunk: (chunk: LLMStreamChunk) => void;
  /** Optional: called with incremental tool-argument character counts while streaming. */
  onToolArgChunk?: (toolName: string, deltaChars: number) => void;
  abortSignal?: AbortSignal;
}

/** Contract every LLM text-completion provider must implement. */
export interface ILLMProvider {
  streamChat(
    messages: ContextManagedLLMMessage[],
    tools: LLMToolDef[],
    options: StreamChatOptions,
  ): Promise<LLMToolCall[]>;
}

/** Runtime config passed to provider factories. */
export interface ProviderConfig {
  provider: string;
  apiKey: string;
  model: string;
  baseUrl?: string;
}
