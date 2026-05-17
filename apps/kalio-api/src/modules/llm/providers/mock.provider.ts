import type { ILLMProvider, LLMToolDef, StreamChatOptions } from '../llm.types';
import type { LLMToolCall } from '@kalio/types';
import type { ContextManagedLLMMessage } from '../../../common/utils/context-managed-llm-message.util';

const MOCK_ERROR_429_TRIGGER = '[[mock:error:429]]';
const MOCK_ERROR_429_MESSAGE = '[MockLLM] LLM request failed: 429 Too Many Requests - { "error": { "code": "429", "message": "quota exhausted", "type": "limitation" } }';
const MOCK_RAAPP_CREATE_NO_ARG_PROGRESS_TRIGGER = '[[mock:tool:raapp_create:no-arg-progress]]';

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
    _tools: LLMToolDef[],
    options: StreamChatOptions,
  ): Promise<LLMToolCall[]> {
    const { sessionId, messageId, onChunk, abortSignal } = options;
    const lastMessage = getLastUserMessageText(messages);
    if (lastMessage.includes(MOCK_ERROR_429_TRIGGER)) {
      throw new Error(MOCK_ERROR_429_MESSAGE);
    }

    if (lastMessage.includes(MOCK_RAAPP_CREATE_NO_ARG_PROGRESS_TRIGGER)) {
      return [{
        id: `mock_tool_${Date.now()}`,
        name: 'raapp_create',
        args: {
          type: 'html',
          mode: 'interactive',
          content: '<!DOCTYPE html><html><head><title>Mock Tool Intent</title></head><body><h1>Mock Tool Intent</h1></body></html>',
        },
      }];
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
