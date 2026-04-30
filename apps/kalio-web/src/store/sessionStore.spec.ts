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

describe('sessionStore.flushThinkingChunks — tool-start regression', () => {
  beforeEach(() => {
    useSessionStore.setState({
      messages: [],
      streamingChunks: {},
      thinkingChunks: {},
      activeSessionId: 'sess-1',
    });
  });

  // REGRESSION: thinking bubble kept animating when LLM went thinking → tool (no text chunk)
  it('moves thinkingChunks content into message.thinking and clears the live map', () => {
    // Simulate: thinking chunks arrived for msg-1 but no text chunk came before tool:start
    useSessionStore.getState().appendChunk('msg-1', 'plan A\n', true);
    useSessionStore.getState().appendChunk('msg-1', 'plan B\n', true);
    expect(useSessionStore.getState().thinkingChunks['msg-1']).toBe('plan A\nplan B\n');

    // tool:start fires — flush thinking
    useSessionStore.getState().flushThinkingChunks();

    // thinkingChunks must be empty → isThinkingStreaming becomes false
    expect(useSessionStore.getState().thinkingChunks['msg-1']).toBeUndefined();
    expect(Object.keys(useSessionStore.getState().thinkingChunks)).toHaveLength(0);

    // thinking content must be persisted in the message
    const msg = useSessionStore.getState().messages.find((m) => m.id === 'msg-1');
    expect(msg?.thinking).toBe('plan A\nplan B\n');
  });

  it('does not touch streamingChunks or text content when flushing thinking', () => {
    useSessionStore.getState().appendChunk('msg-1', 'thought', true);
    // Also add a streaming text chunk for a different message
    useSessionStore.getState().appendChunk('msg-2', 'hello', false);

    useSessionStore.getState().flushThinkingChunks();

    // streamingChunks for msg-2 must be untouched
    expect(useSessionStore.getState().streamingChunks['msg-2']).toBe('hello');
    // thinkingChunks cleared
    expect(useSessionStore.getState().thinkingChunks['msg-1']).toBeUndefined();
  });

  it('is a no-op when there are no live thinkingChunks', () => {
    // Should not throw or mutate anything
    useSessionStore.getState().flushThinkingChunks();
    expect(useSessionStore.getState().thinkingChunks).toEqual({});
  });
});
