import type { ILLMProvider } from '../llm.types';
import type { LLMMessage, LLMStreamChunk, LLMToolCall } from '@kalio/types';

export class MockLLMProvider implements ILLMProvider {
  async streamChat(
    messages: LLMMessage[],
    _tools: Array<{ name: string; description: string; parameters: Record<string, unknown> }>,
    onChunk: (chunk: LLMStreamChunk) => void,
    sessionId: string,
    messageId: string,
  ): Promise<LLMToolCall[]> {
    const lastMessage = messages.at(-1)?.content ?? '';
    const response = `[MockLLM] Echo: ${lastMessage}`;
    const words = response.split(' ');

    for (const word of words) {
      await new Promise<void>((resolve) => setTimeout(resolve, 30));
      onChunk({ delta: word + ' ', done: false, sessionId, messageId });
    }

    onChunk({ delta: '', done: true, sessionId, messageId });
    return [];
  }
}
