import type { LLMMessage } from '@kalio/types';

export interface ContextManagedLLMMessage extends LLMMessage {
  reasoningContent?: string;
}

export function getReasoningContent(message: ContextManagedLLMMessage): string {
  return typeof message.reasoningContent === 'string' ? message.reasoningContent : '';
}