import { useEffect, useState } from 'react';
import { ChevronDown, BrainCircuit } from 'lucide-react';
import { useSessionStore } from '../../store/sessionStore';
import { MarkdownViewer } from '../../components/markdown/MarkdownViewer';
import type { ChatMessage } from '@kalio/types';

interface MessageBubbleProps {
  message: ChatMessage;
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const { streamingChunks, thinkingChunks, sessions } = useSessionStore();
  const [thinkingOpen, setThinkingOpen] = useState(false);

  const isUser = message.role === 'user';
  const isStreaming = message.streaming === true;

  const displayContent = isStreaming
    ? (streamingChunks[message.id] ?? '')
    : message.content;

  const liveThinking = thinkingChunks[message.id] ?? '';
  const historicalThinking = message.thinking ?? '';
  const thinkingContent = liveThinking || historicalThinking;
  const hasThinking = thinkingContent.length > 0;

  // Auto-expand thinking block while streaming so the user sees real reasoning tokens live
  useEffect(() => {
    if (isStreaming && hasThinking && !thinkingOpen) {
      setThinkingOpen(true);
    }
  }, [isStreaming, hasThinking, thinkingOpen]);

  if (isUser) {
    const session = sessions.find((item) => item.id === message.sessionId);
    const userLabel = session?.kind === 'subagent' ? (session.interlocutorLabel ?? 'Master agent') : null;
    return (
      <div data-testid="message-bubble" data-role="user" className="flex justify-end">
        <div className="flex flex-col items-end max-w-[75%]">
          {userLabel && <p className="text-xs text-base-content/50 mb-1 mr-1">{userLabel}</p>}
          <div className="rounded-2xl px-4 py-2 text-sm bg-primary text-primary-content">
            <span data-testid="message-content">{displayContent}</span>
          </div>
        </div>
      </div>
    );
  }

  // tool_result messages are rendered inside AgentTurnBubble — skip here to avoid duplicate JSON bubbles
  if (message.role === 'tool_result') return null;
  return (
    <div data-testid="message-bubble" data-role="assistant" className="flex justify-start mb-1 w-full">
      <div className="min-w-0 w-full max-w-[min(100%,68rem)]">
        <p className="text-xs text-base-content/50 mb-1 ml-1">Kalio</p>

        <div className="group relative rounded-2xl bg-base-300 text-base-content text-sm px-4 py-3 flex flex-col gap-2 w-full">
          {/* Thinking block */}
          {hasThinking && (
            <div className="border border-base-content/10 rounded-lg overflow-hidden">
              <button
                className="flex items-center gap-2 w-full px-3 py-2 text-xs text-base-content/50 hover:text-base-content/70 transition-colors bg-base-200/50"
                onClick={() => setThinkingOpen((v) => !v)}
              >
                <BrainCircuit size={12} className={liveThinking.length > 0 ? 'text-sky-400 animate-pulse' : 'text-base-content/40'} />
                <span>Thinking</span>
                {liveThinking.length > 0 && (
                  <span className="loading loading-dots loading-xs ml-1" />
                )}
                <ChevronDown
                  size={12}
                  className={`ml-auto transition-transform duration-150 ${thinkingOpen ? 'rotate-180' : ''}`}
                />
              </button>
              {thinkingOpen && (
                <div className="px-3 py-2 text-xs text-base-content/50 font-mono whitespace-pre-wrap max-h-60 overflow-y-auto bg-base-200/20">
                  {thinkingContent}
                  {liveThinking.length > 0 && (
                    <span className="inline-block h-3 w-0.5 animate-pulse bg-current ml-0.5" />
                  )}
                </div>
              )}
            </div>
          )}

          {/* Main content */}
          {isStreaming && !displayContent && !hasThinking ? (
            <span data-testid="streaming-indicator" className="loading loading-dots loading-xs" />
          ) : displayContent ? (
            <div data-testid="message-content">
              <MarkdownViewer content={displayContent} />
              {isStreaming && (
                <span className="ml-0.5 inline-block h-3.5 w-0.5 animate-pulse bg-current" />
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

