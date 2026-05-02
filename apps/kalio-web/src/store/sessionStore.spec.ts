import { describe, it, expect, beforeEach } from 'vitest';
import type { ChatMessage } from '@kalio/types';
import { useSessionStore } from './sessionStore';

describe('sessionStore.appendChunk — thinking phase clear', () => {
  beforeEach(() => {
    useSessionStore.setState({
      messages: [],
      sessionMessages: {},
      streamingChunks: {},
      thinkingChunks: {},
      chunkSessionIds: {},
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
      sessionMessages: {},
      streamingChunks: {},
      thinkingChunks: {},
      chunkSessionIds: {},
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

// ─── REGRESSION: streaming content not lost on session switch ─────────────────
describe('sessionStore — session-isolated streaming (REGRESSION)', () => {
  beforeEach(() => {
    useSessionStore.setState({
      messages: [],
      sessionMessages: {},
      streamingChunks: {},
      thinkingChunks: {},
      chunkSessionIds: {},
      activeSessionId: 'sess-A',
      agentTurns: [],
      sessionAgentTurns: {},
      activeTurnId: null,
      sessionActiveTurnIds: {},
    });
  });

  it('restores non-active child turn items when switching into that session mid-stream', () => {
    useSessionStore.setState({
      activeSessionId: 'sess-parent',
      messages: [],
      streamingChunks: {},
      thinkingChunks: {},
      chunkSessionIds: {},
      agentTurns: [],
      activeTurnId: null,
    });

    const store = useSessionStore.getState() as typeof useSessionStore.getState extends () => infer T
      ? T & {
          addTurnItem: (item: { kind: 'tool'; callId: string } | { kind: 'text'; messageId: string }, sessionId?: string) => void;
        }
      : never;

    store.startAgentTurn('child-turn-1', 'sess-child');
    store.addTurnItem({ kind: 'tool', callId: 'call-child-1' }, 'sess-child');
    store.addTurnItem({ kind: 'text', messageId: 'child-msg-1' }, 'sess-child');
    store.appendChunk('child-msg-1', 'child draft', false, 'sess-child');

    useSessionStore.getState().setActiveSession('sess-child');

    expect(useSessionStore.getState().messages.find((message) => message.id === 'child-msg-1')?.content).toBe('child draft');
    expect(useSessionStore.getState().activeTurnId).toBe('child-turn-1');
    expect(useSessionStore.getState().agentTurns).toEqual([
      expect.objectContaining({
        id: 'child-turn-1',
        sessionId: 'sess-child',
        done: false,
        items: [
          { kind: 'tool', callId: 'call-child-1' },
          { kind: 'text', messageId: 'child-msg-1' },
        ],
      }),
    ]);
  });

  it('restores non-active child tool_result messages when switching into that session', () => {
    useSessionStore.setState({
      activeSessionId: 'sess-parent',
      messages: [],
      streamingChunks: {},
      thinkingChunks: {},
      chunkSessionIds: {},
      agentTurns: [],
      activeTurnId: null,
    });

    useSessionStore.getState().addMessage({
      id: 'tool-result-child',
      sessionId: 'sess-child',
      role: 'tool_result',
      content: '{"ok":true}',
      toolCallId: 'call-child-1',
      createdAt: 1,
    });

    useSessionStore.getState().setActiveSession('sess-child');

    expect(useSessionStore.getState().messages).toEqual([
      expect.objectContaining({
        id: 'tool-result-child',
        sessionId: 'sess-child',
        role: 'tool_result',
        toolCallId: 'call-child-1',
      }),
    ]);
  });

  it('chunks for non-active session accumulate in streamingChunks but do not touch messages', () => {
    // First chunk for sess-A while active
    useSessionStore.getState().appendChunk('msg-1', 'Hello', false, 'sess-A');
    expect(useSessionStore.getState().messages.some((m) => m.id === 'msg-1')).toBe(true);

    // Switch to sess-B
    useSessionStore.setState({ activeSessionId: 'sess-B', messages: [] });

    // More chunks for sess-A arrive while on sess-B
    useSessionStore.getState().appendChunk('msg-1', ' world', false, 'sess-A');

    // Session B messages should NOT contain msg-1
    expect(useSessionStore.getState().messages.some((m) => m.id === 'msg-1')).toBe(false);
    // streamingChunks accumulates both deltas
    expect(useSessionStore.getState().streamingChunks['msg-1']).toBe('Hello world');
    // chunkSessionIds tracks the session
    expect(useSessionStore.getState().chunkSessionIds['msg-1']).toBe('sess-A');
  });

  it('setMessages merges with in-progress streaming messages for active session', () => {
    useSessionStore.setState({
      activeSessionId: 'sess-A',
      streamingChunks: { 'msg-streaming': 'partial content' },
      chunkSessionIds: { 'msg-streaming': 'sess-A' },
      messages: [],
    });

    const historical: ChatMessage[] = [
      { id: 'old-msg', sessionId: 'sess-A', role: 'user', content: 'Hello', createdAt: 1 },
    ];
    useSessionStore.getState().setMessages(historical);

    const msgs = useSessionStore.getState().messages;
    expect(msgs.some((m) => m.id === 'old-msg')).toBe(true);
    expect(msgs.some((m) => m.id === 'msg-streaming' && m.streaming === true)).toBe(true);
    expect(msgs.find((m) => m.id === 'msg-streaming')?.content).toBe('partial content');
  });

  it('setActiveSession restores pending streaming messages when switching back', () => {
    useSessionStore.setState({
      activeSessionId: 'sess-B',
      messages: [],
      streamingChunks: { 'msg-A': 'partial from A' },
      chunkSessionIds: { 'msg-A': 'sess-A' },
      agentTurns: [],
      activeTurnId: null,
    });

    useSessionStore.getState().setActiveSession('sess-A');

    const msgs = useSessionStore.getState().messages;
    expect(msgs.some((m) => m.id === 'msg-A' && m.streaming === true)).toBe(true);
    expect(msgs.find((m) => m.id === 'msg-A')?.content).toBe('partial from A');
    // Should have created a synthetic agentTurn for the in-progress message
    expect(useSessionStore.getState().agentTurns.length).toBe(1);
    expect(useSessionStore.getState().activeTurnId).toBeTruthy();
  });

  it('setActiveSession creates no synthetic turn when no in-progress stream for target session', () => {
    useSessionStore.setState({
      activeSessionId: 'sess-B',
      messages: [],
      streamingChunks: { 'msg-A': 'some content' },
      chunkSessionIds: { 'msg-A': 'sess-A' },
      agentTurns: [],
    });

    // Switch to sess-C (not sess-A, so no pending chunks)
    useSessionStore.getState().setActiveSession('sess-C');

    expect(useSessionStore.getState().agentTurns.length).toBe(0);
    expect(useSessionStore.getState().activeTurnId).toBeNull();
    expect(useSessionStore.getState().messages.length).toBe(0);
  });

  it('finalizeChunk cleans up chunkSessionIds', () => {
    useSessionStore.setState({
      messages: [{ id: 'msg-1', sessionId: 'sess-A', role: 'assistant', content: '', streaming: true, createdAt: 1 }],
      streamingChunks: { 'msg-1': 'done content' },
      thinkingChunks: {},
      chunkSessionIds: { 'msg-1': 'sess-A' },
      activeSessionId: 'sess-A',
    });

    useSessionStore.getState().finalizeChunk('msg-1');

    expect(useSessionStore.getState().chunkSessionIds['msg-1']).toBeUndefined();
    expect(useSessionStore.getState().streamingChunks['msg-1']).toBeUndefined();
    const msg = useSessionStore.getState().messages.find((m) => m.id === 'msg-1');
    expect(msg?.content).toBe('done content');
    expect(msg?.streaming).toBe(false);
  });

  it('finalizeChunk for non-active session does not touch messages but cleans up tracking', () => {
    useSessionStore.setState({
      activeSessionId: 'sess-B',
      messages: [], // sess-B messages
      streamingChunks: { 'msg-A': 'full content' },
      thinkingChunks: {},
      chunkSessionIds: { 'msg-A': 'sess-A' },
    });

    useSessionStore.getState().finalizeChunk('msg-A');

    // Messages unchanged (no sess-A message to update)
    expect(useSessionStore.getState().messages.length).toBe(0);
    // Tracking cleaned up
    expect(useSessionStore.getState().chunkSessionIds['msg-A']).toBeUndefined();
    expect(useSessionStore.getState().streamingChunks['msg-A']).toBeUndefined();
  });
});
