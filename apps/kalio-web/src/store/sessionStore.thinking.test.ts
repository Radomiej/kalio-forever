import { beforeEach, describe, expect, it } from 'vitest';
import type { ChatMessage } from '@kalio/types';
import { mergeFetchedMessages } from '../features/chat/chatUtils';
import { useSessionStore } from './sessionStore';

const message = (thinking: string): ChatMessage => ({
  id: 'assistant', sessionId: 's1', role: 'assistant', content: '',
  thinking, turnId: 'turn', promptMessageId: 'prompt', createdAt: 1,
});

beforeEach(() => {
  useSessionStore.setState({
    activeSessionId: 's1', messages: [], sessionMessages: {},
    streamingChunks: {}, thinkingChunks: {}, chunkSessionIds: {},
    agentTurns: [], sessionAgentTurns: {}, activeTurnId: null, sessionActiveTurnIds: {},
  });
});

describe('provider-exposed thinking across phases', () => {
  it.each(['text', 'tool', 'finalize'] as const)('retains both phases through %s', (ending) => {
    const store = useSessionStore.getState();
    store.appendChunk('assistant', 'A\n', true, 's1');
    store.flushThinkingChunks('s1');
    store.appendChunk('assistant', 'B\n', true, 's1');
    expect(useSessionStore.getState().getSessionMessages('s1')[0].thinking).toBe('A\nB\n');
    if (ending === 'text') store.appendChunk('assistant', 'Answer', false, 's1');
    if (ending === 'tool') store.flushThinkingChunks('s1');
    store.finalizeChunk('assistant');
    expect(useSessionStore.getState().getSessionMessages('s1')[0]).toMatchObject({
      id: 'assistant', thinking: 'A\nB\n', streaming: false,
    });
  });

  it('retains repeated deltas verbatim and isolates another message/session', () => {
    const store = useSessionStore.getState();
    store.appendChunk('assistant', 'Again. ', true, 's1');
    store.appendChunk('other', 'Foreign', true, 's2');
    store.flushThinkingChunks('s1');
    store.flushThinkingChunks('s1');
    store.appendChunk('assistant', 'Again. ', true, 's1');
    store.finalizeChunk('assistant');
    expect(useSessionStore.getState().getSessionMessages('s1')[0].thinking).toBe('Again. Again. ');
    expect(useSessionStore.getState().thinkingChunks.other).toBe('Foreign');
    expect(useSessionStore.getState().getSessionMessages('s2')[0].id).toBe('other');
  });

  it.each([
    ['B\n', 'A\nB\n', 'A\nB\n'],
    ['B\nC\n', 'A\nB\n', 'A\nB\n'],
    ['A\nB\nC\n', 'A\nB\n', 'A\nB\nC\n'],
  ])('hydrates live %j from durable %j without replay', (live, durable, expected) => {
    const store = useSessionStore.getState();
    store.appendChunk('assistant', live, true, 's1');
    store.appendChunk('other', 'Foreign', true, 's2');
    const hydrate = () => store.setMessages(mergeFetchedMessages(
      useSessionStore.getState().getSessionMessages('s1'), [message(durable)],
    ), 's1');
    hydrate();
    hydrate();
    expect(useSessionStore.getState().getSessionMessages('s1')[0]).toMatchObject({
      id: 'assistant', thinking: expected, turnId: 'turn', promptMessageId: 'prompt',
    });
    expect(useSessionStore.getState().thinkingChunks.assistant).toBe(expected);
    store.appendChunk('assistant', 'D\n', true, 's1');
    store.flushThinkingChunks('s1');
    store.finalizeChunk('assistant');
    expect(useSessionStore.getState().getSessionMessages('s1')[0].thinking).toBe(`${expected}D\n`);
    expect(useSessionStore.getState().thinkingChunks.other).toBe('Foreign');
  });
});
