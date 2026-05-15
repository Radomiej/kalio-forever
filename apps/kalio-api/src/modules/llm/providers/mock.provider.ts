import type { ILLMProvider } from '../llm.types';
import type { LLMStreamChunk, LLMToolCall } from '@kalio/types';
import type { ContextManagedLLMMessage } from '../../../common/utils/context-managed-llm-message.util';

export class MockLLMProvider implements ILLMProvider {
  async streamChat(
    messages: ContextManagedLLMMessage[],
    _tools: Array<{ name: string; description: string; parameters: Record<string, unknown> }>,
    onChunk: (chunk: LLMStreamChunk) => void,
    sessionId: string,
    messageId: string,
    abortSignal?: AbortSignal,
  ): Promise<LLMToolCall[]> {
    const lastMessage = messages.at(-1)?.content ?? '';
    const response = `[MockLLM] Echo: ${lastMessage}`;
    const words = response.split(' ');

    for (const word of words) {
      if (abortSignal?.aborted) {
        return [];
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 30));
      if (abortSignal?.aborted) {
        return [];
      }
      onChunk({ delta: word + ' ', done: false, sessionId, messageId });
    }

    if (!abortSignal?.aborted) {
      onChunk({ delta: '', done: true, sessionId, messageId });
    }
    return [];
  }
}
