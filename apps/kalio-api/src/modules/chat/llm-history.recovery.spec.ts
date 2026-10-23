import { describe, expect, it } from 'vitest';
import { compactLLMHistory } from './llm-history.utils';

describe('approved tool recovery context', () => {
  it('retains the current committed tool result before discarding old assistant prose', () => {
    const history = compactLLMHistory([
      { role: 'user', content: 'Old task' },
      { role: 'assistant', content: 'Old report '.repeat(1000) },
      { role: 'user', content: 'Run exactly one approved build, then read its output.' },
      { role: 'assistant', content: '' },
      { role: 'tool', toolCallId: 'approved-build', content: '{"id":"already-started-terminal","command":"npm run build"}' },
    ], 1000, []);

    expect(history).toContainEqual(expect.objectContaining({
      role: 'tool', toolCallId: 'approved-build',
    }));
  });

  it('preserves the latest request when older user messages consume the budget', () => {
    const history = compactLLMHistory([
      { role: 'user', content: 'Old user text '.repeat(1000) },
      { role: 'user', content: 'CURRENT_REQUEST read the already-started terminal' },
      { role: 'tool', toolCallId: 'approved-build', content: '{"id":"terminal"}' },
    ], 1000, []);

    expect(history).toContainEqual(expect.objectContaining({
      role: 'user', content: 'CURRENT_REQUEST read the already-started terminal',
    }));
    expect(history).toContainEqual(expect.objectContaining({
      role: 'tool', toolCallId: 'approved-build',
    }));
  });

  it('leaves under-budget messages untouched', () => {
    const messages = [
      { role: 'user' as const, content: 'Read terminal' },
      { role: 'tool' as const, toolCallId: 'call', content: '{"id":"terminal"}' },
    ];
    expect(compactLLMHistory(messages, 32000, [])).toEqual(messages);
  });

  it('removes a historical multi-call exchange atomically', () => {
    const history = compactLLMHistory([
      { role: 'user', content: 'Old task' },
      { role: 'assistant', content: '', toolCalls: [
        { id: 'old-a', name: 'fs_read', args: {} },
        { id: 'old-b', name: 'fs_read', args: {} },
      ] },
      { role: 'tool', toolCallId: 'old-a', content: 'x'.repeat(4000) },
      { role: 'tool', toolCallId: 'old-b', content: 'small result' },
      { role: 'user', content: 'Current task' },
    ], 1000, []);
    expect(history.some((message) => message.toolCallId === 'old-b')).toBe(false);
  });

  it('keeps the owner and every result across a user approval boundary', () => {
    const owner = { role: 'assistant' as const, content: '', toolCalls: [
      { id: 'a', name: 'terminal_spawn', args: {} },
      { id: 'b', name: 'terminal_list', args: {} },
    ] };
    const history = compactLLMHistory([
      { role: 'user', content: 'Old task '.repeat(1000) }, owner,
      { role: 'tool', toolCallId: 'b', content: '[]' },
      { role: 'user', content: 'Approve once' },
      { role: 'tool', toolCallId: 'a', content: '{"id":"started"}' },
    ], 1000, []);
    expect(history).toContainEqual(owner);
    expect(history.filter((message) => message.role === 'tool')).toHaveLength(2);
  });

  it('fails closed rather than dropping irreducible active tool evidence', () => {
    expect(() => compactLLMHistory([
      { role: 'user', content: 'Current task' },
      { role: 'tool', toolCallId: 'active', content: 'x'.repeat(5000) },
    ], 1000, [])).toThrow('committed tool evidence cannot be discarded');
  });
});
