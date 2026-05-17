import { describe, expect, it, vi } from 'vitest';
import type { ContextManagedLLMMessage } from '../../../common/utils/context-managed-llm-message.util';
import { MockLLMProvider } from './mock.provider';

describe('MockLLMProvider', () => {
  it('REGRESSION: throws a deterministic 429-like error when the last user prompt requests mock quota exhaustion', async () => {
    const provider = new MockLLMProvider();
    const onChunk = vi.fn();
    const messages: ContextManagedLLMMessage[] = [
      {
        role: 'user',
        content: 'Please simulate provider failure [[mock:error:429]]',
      },
    ];

    await expect(
      provider.streamChat(messages, [], { sessionId: 'session-1', messageId: 'message-1', onChunk }),
    ).rejects.toThrow(/429|quota exhausted|Too Many Requests/i);
    expect(onChunk).not.toHaveBeenCalled();
  });

  it('REGRESSION: returns a deterministic raapp_create tool call without arg-progress chunks for fallback UX e2e', async () => {
    const provider = new MockLLMProvider();
    const onChunk = vi.fn();
    const onToolArgChunk = vi.fn();
    const messages: ContextManagedLLMMessage[] = [
      {
        role: 'user',
        content: 'Please trigger fallback tool intent [[mock:tool:raapp_create:no-arg-progress]]',
      },
    ];

    const toolCalls = await provider.streamChat(
      messages,
      [{ name: 'raapp_create', description: 'Create an app', parameters: {} }],
      { sessionId: 'session-1', messageId: 'message-1', onChunk, onToolArgChunk },
    );

    expect(onChunk).not.toHaveBeenCalled();
    expect(onToolArgChunk).not.toHaveBeenCalled();
    expect(toolCalls).toEqual([
      expect.objectContaining({
        name: 'raapp_create',
        args: expect.objectContaining({
          type: 'html',
          mode: 'interactive',
        }),
      }),
    ]);
  });
});