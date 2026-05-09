import type { LLMMessage } from '@kalio/types';
import type { ToolMeta } from '@kalio/types';
import type { InternalLLMChunk } from './llm-chunk.types';

export interface LLMSourceParams {
  messages: LLMMessage[];
  tools: ToolMeta[];
  sessionId: string;
  messageId: string;
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
