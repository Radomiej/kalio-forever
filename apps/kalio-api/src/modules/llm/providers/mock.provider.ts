import type { ILLMProvider } from '../llm.types';
import type { LLMStreamChunk, LLMToolCall } from '@kalio/types';
import type { ContextManagedLLMMessage } from '../../../common/utils/context-managed-llm-message.util';

const MOCK_ERROR_429_TRIGGER = '[[mock:error:429]]';
const MOCK_ERROR_429_MESSAGE = '[MockLLM] LLM request failed: 429 Too Many Requests - { "error": { "code": "429", "message": "quota exhausted", "type": "limitation" } }';

function contentToText(content: ContextManagedLLMMessage['content']): string {
  if (typeof content === 'string') {
    return content;
  }

  return content
    .map((part) => (part.type === 'text' ? part.text : ''))
    .join(' ')
    .trim();
}

function getLastUserMessageText(messages: ContextManagedLLMMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'user') {
      return contentToText(messages[index].content);
    }
  }

  return '';
}

export class MockLLMProvider implements ILLMProvider {
  async streamChat(
    messages: ContextManagedLLMMessage[],
    _tools: Array<{ name: string; description: string; parameters: Record<string, unknown> }>,
    onChunk: (chunk: LLMStreamChunk) => void,
    sessionId: string,
    messageId: string,
    abortSignal?: AbortSignal,
  ): Promise<LLMToolCall[]> {
    const lastMessage = getLastUserMessageText(messages);
    if (lastMessage.includes(MOCK_ERROR_429_TRIGGER)) {
      throw new Error(MOCK_ERROR_429_MESSAGE);
    }

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
