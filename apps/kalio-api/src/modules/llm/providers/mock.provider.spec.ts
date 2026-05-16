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
      provider.streamChat(messages, [], onChunk, 'session-1', 'message-1'),
    ).rejects.toThrow(/429|quota exhausted|Too Many Requests/i);
    expect(onChunk).not.toHaveBeenCalled();
  });
});