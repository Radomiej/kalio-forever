import { describe, it, expect } from 'vitest';
import { trimToContextWindow, estimateTokens } from './context-window';
import type { LLMMessage } from '@kalio/types';

describe('estimateTokens', () => {
  it('estimates ~1 token per 4 chars', () => {
    expect(estimateTokens('hello')).toBe(2); // 5 chars → ceil(5/4) = 2
    expect(estimateTokens('hello world')).toBe(3); // 11 chars → ceil(11/4) = 3
    expect(estimateTokens('')).toBe(0);
  });
});

describe('trimToContextWindow', () => {
  function makeHistory(pairs: [role: LLMMessage['role'], content: string][]): LLMMessage[] {
    return [
      { role: 'system', content: 'You are a helpful assistant.' },
      ...pairs.map(([role, content]) => ({ role, content } as LLMMessage)),
    ];
  }

  it('returns history unchanged if it fits', () => {
    const history = makeHistory([
      ['user', 'Hello'],
      ['assistant', 'Hi there!'],
    ]);
    const result = trimToContextWindow(history, 100000);
    expect(result).toEqual(history);
  });

  it('returns singleton (just system prompt) unchanged', () => {
    const history: LLMMessage[] = [{ role: 'system', content: 'sys' }];
    expect(trimToContextWindow(history, 1)).toEqual(history);
  });

  it('drops oldest messages when context is exceeded', () => {
    // System: ~7 chars = 2 tokens
    // 10 user+assistant pairs, each ~100 chars = 25 tokens per pair
    const pairs: [LLMMessage['role'], string][] = [];
    for (let i = 0; i < 10; i++) {
      pairs.push(['user', `User message number ${i} with some content here padding`]);
      pairs.push(['assistant', `Assistant reply number ${i} with some content here too`]);
    }
    const history = makeHistory(pairs);
    const maxTokens = 200; // tight budget
    const result = trimToContextWindow(history, maxTokens);

    // System prompt always kept
    expect(result[0]!.role).toBe('system');

    // Total tokens should be reasonable (trim notice can add a small overhead)
    const totalTokens = result.reduce((sum, m) => sum + estimateTokens(m.content), 0);
    expect(totalTokens).toBeLessThanOrEqual(maxTokens + 30); // allow for trim notice overhead

    // Newer messages should be preserved over older ones
    expect(result.length).toBeLessThan(history.length);
  });

  it('inserts a trim notice when messages are dropped', () => {
    const pairs: [LLMMessage['role'], string][] = Array.from({ length: 20 }, (_, i) => [
      'user' as LLMMessage['role'],
      `message ${i} `.repeat(50),
    ]);
    const history = makeHistory(pairs);
    const result = trimToContextWindow(history, 100);

    const notice = result.find((m) => m.content.includes('older message'));
    expect(notice).toBeDefined();
    expect(notice?.role).toBe('system');
  });

  it('preserves the most recent messages when trimming', () => {
    // Build a history where early messages are large, recent ones are small
    const history: LLMMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'a'.repeat(10000) }, // ~2500 tokens — will be dropped
      { role: 'assistant', content: 'b'.repeat(10000) }, // ~2500 tokens — will be dropped
      { role: 'user', content: 'recent question' },
      { role: 'assistant', content: 'recent answer' },
    ];

    const result = trimToContextWindow(history, 50); // very tight
    const contents = result.map((m) => m.content);

    expect(contents).toContain('recent question');
    expect(contents).toContain('recent answer');
    // The big messages should be dropped
    expect(contents).not.toContain('a'.repeat(10000));
  });
});
