import { useSessionStore } from '../../store/sessionStore';
import type { ChatMessage } from '@kalio/types';

interface MessageBubbleProps {
  message: ChatMessage;
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const { streamingChunks } = useSessionStore();
  const isUser = message.role === 'user';
  const isStreaming = message.streaming === true;
  const displayContent = isStreaming
    ? (streamingChunks[message.id] ?? '')
    : message.content;

  return (
    <div
      data-testid="message-bubble"
      data-role={message.role}
      className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}
    >
      <div
        className={`max-w-[75%] rounded-2xl px-4 py-2 text-sm ${
          isUser
            ? 'bg-primary text-primary-content'
            : 'bg-base-300 text-base-content'
        }`}
      >
        {isStreaming && !displayContent ? (
          <span data-testid="streaming-indicator" className="loading loading-dots loading-xs" />
        ) : (
          <span data-testid="message-content">{displayContent}</span>
        )}
        {isStreaming && displayContent && (
          <span className="ml-1 inline-block h-3 w-0.5 animate-pulse bg-current" />
        )}
      </div>
    </div>
  );
}
