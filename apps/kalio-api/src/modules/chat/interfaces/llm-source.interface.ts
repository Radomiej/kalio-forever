import type { ToolMeta } from '@kalio/types';
import type { InternalLLMChunk } from './llm-chunk.types';
import type { ContextManagedLLMMessage } from '../../../common/utils/context-managed-llm-message.util';

export interface LLMSourceParams {
  messages: ContextManagedLLMMessage[];
  tools: ToolMeta[];
  sessionId: string;
  messageId: string;
  abortSignal?: AbortSignal;
}

/**
 * Abstraction over the LLM provider for the chat module.
 * Returns an async iterable of InternalLLMChunks ending with a DoneChunk.
 *
 * Adapters (e.g. LLMServiceAdapter) bridge from the callback-based LLMService
 * to this interface. Not part of @kalio/types — internal to the chat module.
 */
export interface ILLMSource {
  stream(params: LLMSourceParams): AsyncIterable<InternalLLMChunk>;
}
