import type { ChatMessage } from '@kalio/types';

export function isMessageLiveStreaming(
  messageId: string,
  message: Pick<ChatMessage, 'streaming'>,
  streamingChunks: Readonly<Record<string, string>>,
  turnDone: boolean,
): boolean {
  if (streamingChunks[messageId] !== undefined) {
    return true;
  }

  return !turnDone && message.streaming === true;
}
