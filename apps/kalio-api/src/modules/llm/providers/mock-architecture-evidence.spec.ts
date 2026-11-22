import { describe, expect, it, vi } from 'vitest';
import { MockLLMProvider } from './mock.provider';

describe('mock architecture evidence fixture', () => {
  it('requests real isolated VFS work only when the slot advertises the write tool', async () => {
    const provider = new MockLLMProvider({ delay: async () => undefined });
    const calls = await provider.streamChat([{ role: 'user', content: '[[mock:architecture:evidence]]' }],
      [{ name: 'vfs_write', description: 'Isolated fixture', parameters: {} }],
      { sessionId: 'fixture', messageId: 'message', onChunk: vi.fn() });
    expect(calls).toEqual([expect.objectContaining({ name: 'vfs_write', args: expect.objectContaining({ filePath: 'e2e/mock-tool-trigger.txt' }) })]);
  });

  it('does not invent writes for a read-only slot', async () => {
    const provider = new MockLLMProvider({ delay: async () => undefined });
    const calls = await provider.streamChat([{ role: 'user', content: '[[mock:architecture:evidence]]' }], [],
      { sessionId: 'fixture', messageId: 'message', onChunk: vi.fn() });
    expect(calls).toEqual([]);
  });

  it('finishes after the actual VFS result instead of requesting repeated writes', async () => {
    const provider = new MockLLMProvider({ delay: async () => undefined });
    const onChunk = vi.fn();
    const calls = await provider.streamChat([
      { role: 'user', content: '[[mock:architecture:evidence]]' },
      { role: 'tool', toolCallId: 'write', content: JSON.stringify({ name: 'vfs_write', result: { filePath: 'e2e/mock-tool-trigger.txt', bytesWritten: 25 } }) },
    ], [{ name: 'vfs_write', description: 'Isolated fixture', parameters: {} }],
    { sessionId: 'fixture', messageId: 'message', onChunk });
    expect(calls).toEqual([]);
    expect(onChunk).toHaveBeenCalledWith(expect.objectContaining({ delta: expect.stringContaining('VFS tool evidence') }));
  });
});
