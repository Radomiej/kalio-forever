import { describe, it, expect } from 'vitest';
import { getCompactStrategy } from './compactStrategy';
import type { ChatMessage } from '@kalio/types';

function makeMsg(overrides: Partial<ChatMessage>): ChatMessage {
  return {
    id: 'msg-default',
    sessionId: 's1',
    role: 'assistant',
    content: '12345678',
    createdAt: 1,
    ...overrides,
  };
}

describe('compactStrategy', () => {
  describe('auto-trim strategy', () => {
    it('should remove old messages when approaching limit', () => {
      const strategy = getCompactStrategy('auto-trim');
      
      const messages: ChatMessage[] = [
        { id: '1', sessionId: 's1', role: 'user', content: 'First message', createdAt: 1 },
        { id: '2', sessionId: 's1', role: 'assistant', content: 'Response 1', createdAt: 2 },
        { id: '3', sessionId: 's1', role: 'user', content: 'Second message', createdAt: 3 },
        { id: '4', sessionId: 's1', role: 'assistant', content: 'Response 2', createdAt: 4 },
      ];

      const compacted = strategy.compact(messages, 100);
      
      // Should keep first user message and trim others
      expect(compacted.length).toBeLessThanOrEqual(messages.length);
      expect(compacted[0].id).toBe('1'); // First user message preserved
    });

    it('should preserve first user message', () => {
      const strategy = getCompactStrategy('auto-trim');
      
      const messages: ChatMessage[] = [
        { id: '1', sessionId: 's1', role: 'user', content: 'First', createdAt: 1 },
        { id: '2', sessionId: 's1', role: 'assistant', content: 'Response', createdAt: 2 },
      ];

      const compacted = strategy.compact(messages, 10);
      
      expect(compacted[0].id).toBe('1');
    });

    it('should return as-is if under safe target', () => {
      const strategy = getCompactStrategy('auto-trim');
      
      const messages: ChatMessage[] = [
        { id: '1', sessionId: 's1', role: 'user', content: 'Short', createdAt: 1 },
      ];

      const compacted = strategy.compact(messages, 10000);
      
      expect(compacted).toEqual(messages);
    });

    it('removes tool_result messages before plain assistant replies (REGRESSION)', () => {
      const strategy = getCompactStrategy('auto-trim');

      const messages: ChatMessage[] = [
        makeMsg({ id: 'u1', role: 'user' }),
        makeMsg({ id: 'a1', role: 'assistant' }),
        makeMsg({ id: 'u2', role: 'user' }),
        makeMsg({ id: 'tr1', role: 'tool_result' }),
        makeMsg({ id: 'a2', role: 'assistant' }),
      ];

      const compacted = strategy.compact(messages, 11);

      expect(compacted.map((message) => message.id)).toEqual(['u1', 'a1', 'u2', 'a2']);
    });

    it('preserves later user messages while assistant messages are still available to trim (REGRESSION)', () => {
      const strategy = getCompactStrategy('auto-trim');

      const messages: ChatMessage[] = [
        makeMsg({ id: 'u1', role: 'user' }),
        makeMsg({ id: 'u2', role: 'user' }),
        makeMsg({ id: 'a1', role: 'assistant' }),
        makeMsg({ id: 'a2', role: 'assistant' }),
      ];

      const compacted = strategy.compact(messages, 8);

      expect(compacted.map((message) => message.id)).toEqual(['u1', 'u2', 'a2']);
    });

    it('still compacts assistant-only histories that exceed the limit (REGRESSION)', () => {
      const strategy = getCompactStrategy('auto-trim');

      const messages: ChatMessage[] = [
        makeMsg({ id: 'a1', role: 'assistant' }),
        makeMsg({ id: 'a2', role: 'assistant' }),
        makeMsg({ id: 'a3', role: 'assistant' }),
      ];

      const compacted = strategy.compact(messages, 5);

      expect(compacted.length).toBeLessThan(messages.length);
    });

    it('removes a tool_call assistant and its tool_result together, not one side only (REGRESSION)', () => {
      const strategy = getCompactStrategy('auto-trim');

      const messages: ChatMessage[] = [
        makeMsg({ id: 'u1', role: 'user' }),
        makeMsg({ id: 'a-tool', role: 'assistant', content: 'tool', toolCalls: [{ id: 'call-1', name: 'vfs_read', args: { path: '/tmp' } }] }),
        makeMsg({ id: 'tr1', role: 'tool_result', toolCallId: 'call-1' }),
        makeMsg({ id: 'a-final', role: 'assistant' }),
      ];

      const compacted = strategy.compact(messages, 8);

      expect(compacted.map((message) => message.id)).toEqual(['u1', 'a-final']);
    });
  });

  describe('warn-only strategy', () => {
    it('should return messages unchanged', () => {
      const strategy = getCompactStrategy('warn-only');
      
      const messages: ChatMessage[] = [
        { id: '1', sessionId: 's1', role: 'user', content: 'Message 1', createdAt: 1 },
        { id: '2', sessionId: 's1', role: 'assistant', content: 'Message 2', createdAt: 2 },
      ];

      const compacted = strategy.compact(messages, 10);
      
      expect(compacted).toEqual(messages);
    });
  });

  describe('getCompactStrategy', () => {
    it('should return auto-trim strategy by name', () => {
      const strategy = getCompactStrategy('auto-trim');
      expect(strategy.name).toBe('auto-trim');
    });

    it('should return warn-only strategy by name', () => {
      const strategy = getCompactStrategy('warn-only');
      expect(strategy.name).toBe('warn-only');
    });

    it('should return warn-only for unknown strategy', () => {
      const strategy = getCompactStrategy('unknown');
      expect(strategy.name).toBe('warn-only');
    });
  });
});
