import { describe, it, expect, beforeEach } from 'vitest';
import { useSessionStore } from './sessionStore';

describe('sessionStore.appendChunk — thinking phase clear', () => {
  beforeEach(() => {
    useSessionStore.setState({
      messages: [],
      streamingChunks: {},
      thinkingChunks: {},
      activeSessionId: 'sess-1',
    });
  });

  it('accumulates thinking chunks independently from text chunks', () => {
    useSessionStore.getState().appendChunk('msg-1', 'thinking…', true);
    expect(useSessionStore.getState().thinkingChunks['msg-1']).toBe('thinking…');
    expect(useSessionStore.getState().streamingChunks['msg-1']).toBeUndefined();
  });

  it('clears thinkingChunks when first text chunk arrives for same messageId', () => {
    useSessionStore.getState().appendChunk('msg-1', 'let me think', true);
    expect(useSessionStore.getState().thinkingChunks['msg-1']).toBe('let me think');

    // first non-thinking chunk should flush thinking to message.thinking
    useSessionStore.getState().appendChunk('msg-1', 'Hello', false);

    expect(useSessionStore.getState().thinkingChunks['msg-1']).toBeUndefined();
    const msg = useSessionStore.getState().messages.find((m) => m.id === 'msg-1');
    expect(msg?.thinking).toBe('let me think');
    expect(useSessionStore.getState().streamingChunks['msg-1']).toBe('Hello');
  });

  it('does NOT clear thinkingChunks for a different messageId', () => {
    useSessionStore.getState().appendChunk('msg-A', 'thinking A', true);
    useSessionStore.getState().appendChunk('msg-B', 'Hello B', false);
    // msg-A thinking should remain since msg-B is a different message
    expect(useSessionStore.getState().thinkingChunks['msg-A']).toBe('thinking A');
  });
});
