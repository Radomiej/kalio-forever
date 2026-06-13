import type { ChatMessage } from '@kalio/types';
import type { AgentTurnItem } from '../../store/sessionStore';
import { isMessageLiveStreaming } from './agentTurnStreaming';

function normalizeAssistantContent(content: string): string {
  return content.replace(/\r\n/g, '\n').trim();
}

function buildDedupKey(
  item: AgentTurnItem,
  messageById: ReadonlyMap<string, ChatMessage>,
  streamingChunks: Readonly<Record<string, string>>,
  turnDone: boolean,
): string | null {
  if (item.kind !== 'text') {
    return null;
  }

  const message = messageById.get(item.messageId);
  if (!message || message.role !== 'assistant') {
    return null;
  }

  const isStreaming = isMessageLiveStreaming(item.messageId, message, streamingChunks, turnDone);
  if (isStreaming) {
    return null;
  }

  const normalizedContent = normalizeAssistantContent(message.content);
  return normalizedContent.length > 0 ? normalizedContent : null;
}

export function deriveVisibleTurnItems(
  items: AgentTurnItem[],
  messages: ChatMessage[],
  streamingChunks: Readonly<Record<string, string>>,
  turnDone: boolean,
): AgentTurnItem[] {
  const messageById = new Map(messages.map((message) => [message.id, message] as const));
  const lastIndexByContent = new Map<string, number>();

  items.forEach((item, index) => {
    const dedupKey = buildDedupKey(item, messageById, streamingChunks, turnDone);
    if (dedupKey) {
      lastIndexByContent.set(dedupKey, index);
    }
  });

  return items.filter((item, index) => {
    const dedupKey = buildDedupKey(item, messageById, streamingChunks, turnDone);
    return !dedupKey || lastIndexByContent.get(dedupKey) === index;
  });
}
