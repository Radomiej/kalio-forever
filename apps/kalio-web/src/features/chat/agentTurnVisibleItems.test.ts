import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '@kalio/types';
import type { AgentTurnItem } from '../../store/sessionStore';
import { deriveVisibleTurnItems } from './agentTurnVisibleItems';

function makeAssistantMessage(overrides: Partial<ChatMessage>): ChatMessage {
  return {
    id: 'msg-1',
    sessionId: 'session-1',
    role: 'assistant',
    content: '',
    createdAt: Date.now(),
    ...overrides,
  } as ChatMessage;
}

describe('deriveVisibleTurnItems', () => {
  it('keeps only the last completed assistant text with identical normalized content', () => {
    const items: AgentTurnItem[] = [
      { kind: 'text', messageId: 'msg-before-tool' },
      { kind: 'tool', callId: 'tool-1' },
      { kind: 'text', messageId: 'msg-after-tool' },
    ];
    const messages: ChatMessage[] = [
      makeAssistantMessage({ id: 'msg-before-tool', content: 'Same answer\r\n' }),
      makeAssistantMessage({ id: 'msg-after-tool', content: '\nSame answer' }),
    ];

    expect(deriveVisibleTurnItems(items, messages, {}, true)).toEqual([
      { kind: 'tool', callId: 'tool-1' },
      { kind: 'text', messageId: 'msg-after-tool' },
    ]);
  });

  it('keeps distinct assistant texts visible within the same turn', () => {
    const items: AgentTurnItem[] = [
      { kind: 'text', messageId: 'msg-before-tool' },
      { kind: 'tool', callId: 'tool-1' },
      { kind: 'text', messageId: 'msg-after-tool' },
    ];
    const messages: ChatMessage[] = [
      makeAssistantMessage({ id: 'msg-before-tool', content: 'Initial answer' }),
      makeAssistantMessage({ id: 'msg-after-tool', content: 'Updated answer' }),
    ];

    expect(deriveVisibleTurnItems(items, messages, {}, true)).toEqual(items);
  });

  it('keeps later streaming assistant text visible even when content currently matches', () => {
    const items: AgentTurnItem[] = [
      { kind: 'text', messageId: 'msg-before-tool' },
      { kind: 'tool', callId: 'tool-1' },
      { kind: 'text', messageId: 'msg-after-tool' },
    ];
    const messages: ChatMessage[] = [
      makeAssistantMessage({ id: 'msg-before-tool', content: 'Same answer' }),
      makeAssistantMessage({ id: 'msg-after-tool', content: 'Same answer', streaming: true }),
    ];

    expect(
      deriveVisibleTurnItems(items, messages, {
        'msg-after-tool': 'Same answer with extra streamed detail',
      }, false),
    ).toEqual(items);
  });

  it('dedupes stale persisted streaming flags after the turn is done', () => {
    const items: AgentTurnItem[] = [
      { kind: 'text', messageId: 'msg-before-tool' },
      { kind: 'tool', callId: 'tool-1' },
      { kind: 'text', messageId: 'msg-after-tool' },
    ];
    const messages: ChatMessage[] = [
      makeAssistantMessage({ id: 'msg-before-tool', content: 'Same answer' }),
      makeAssistantMessage({ id: 'msg-after-tool', content: 'Same answer', streaming: true }),
    ];

    expect(deriveVisibleTurnItems(items, messages, {}, true)).toEqual([
      { kind: 'tool', callId: 'tool-1' },
      { kind: 'text', messageId: 'msg-after-tool' },
    ]);
  });

  it('keeps active streaming text visible while chunks are still live even if the turn is marked done', () => {
    const items: AgentTurnItem[] = [
      { kind: 'text', messageId: 'msg-before-tool' },
      { kind: 'tool', callId: 'tool-1' },
      { kind: 'text', messageId: 'msg-after-tool' },
    ];
    const messages: ChatMessage[] = [
      makeAssistantMessage({ id: 'msg-before-tool', content: 'Same answer' }),
      makeAssistantMessage({ id: 'msg-after-tool', content: 'Same answer', streaming: true }),
    ];

    expect(
      deriveVisibleTurnItems(items, messages, {
        'msg-after-tool': 'Same answer with trailing chunk',
      }, true),
    ).toEqual(items);
  });

  it('does not dedupe non-assistant text items', () => {
    const items: AgentTurnItem[] = [
      { kind: 'text', messageId: 'tool-result-1' },
      { kind: 'text', messageId: 'tool-result-2' },
    ];
    const messages: ChatMessage[] = [
      makeAssistantMessage({ id: 'tool-result-1', role: 'tool_result', content: 'Same answer' }),
      makeAssistantMessage({ id: 'tool-result-2', role: 'tool_result', content: 'Same answer' }),
    ];

    expect(deriveVisibleTurnItems(items, messages, {}, true)).toEqual(items);
  });
});
