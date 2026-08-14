import { memo, useEffect, useState } from 'react';
import { ChevronDown, BrainCircuit } from 'lucide-react';
import { useSessionStore } from '../../store/sessionStore';
import { MarkdownViewer } from '../../components/markdown/MarkdownViewer';
import type { ChatMessage } from '@kalio/types';

interface MessageBubbleProps {
  message: ChatMessage;
}

const LONG_USER_PROMPT_THRESHOLD = 1200;

function splitUserPrompt(content: string): { visible: string; technical: string | null } {
  if (content.length <= LONG_USER_PROMPT_THRESHOLD) {
    return { visible: content, technical: null };
  }

  const contextIndex = content.search(/(?:^|\s)(Context|Input|Available next nodes|Incoming graph outputs):/);
  if (contextIndex > 240 && contextIndex < content.length - 80) {
    return {
      visible: content.slice(0, contextIndex).trimEnd(),
      technical: content.slice(contextIndex).trimStart(),
    };
  }

  return {
    visible: `${content.slice(0, LONG_USER_PROMPT_THRESHOLD).trimEnd()}\n...`,
    technical: content.slice(LONG_USER_PROMPT_THRESHOLD).trimStart(),
  };
}

function UserMessageContent({ content }: { content: string }) {
  const promptParts = splitUserPrompt(content);
  return (
    <>
      <span data-testid="message-content" className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
        {promptParts.visible}
      </span>
      {promptParts.technical && (
        <details className="mt-2 max-w-full rounded-lg border border-white/15 bg-black/10 px-2 py-1 text-xs text-white/80">
          <summary className="cursor-pointer select-none text-white/70">Technical context</summary>
          <pre className="mt-1 max-h-64 overflow-y-auto whitespace-pre-wrap break-words [overflow-wrap:anywhere] font-mono text-[11px] leading-relaxed">
            {promptParts.technical}
          </pre>
        </details>
      )}
    </>
  );
}

export const MessageBubble = memo(function MessageBubble({ message }: MessageBubbleProps) {
  const liveContent = useSessionStore((state) => state.streamingChunks[message.id] ?? '');
  const liveThinking = useSessionStore((state) => state.thinkingChunks[message.id] ?? '');
  const [thinkingOpen, setThinkingOpen] = useState(false);

  const isUser = message.role === 'user';
  const isStreaming = message.streaming === true;

  const displayContent = isStreaming
    ? liveContent
    : message.content;

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
    return (
      <div data-testid="message-bubble" data-role="user" className="flex justify-end">
        <div className="flex max-w-[min(100%,72rem)] flex-col items-end">
          <div className="max-w-full overflow-hidden rounded-2xl bg-sky-700 px-3.5 py-2 text-sm text-white">
            <UserMessageContent content={displayContent} />
          </div>
        </div>
      </div>
    );
  }

  // tool_result messages are rendered inside AgentTurnBubble — skip here to avoid duplicate JSON bubbles
  if (message.role === 'tool_result') return null;
  return (
    <div data-testid="message-bubble" data-role="assistant" className="flex justify-start mb-1 w-full">
      <div className="min-w-0 w-full max-w-none">
        <p className="text-xs text-base-content/50 mb-1 ml-1">Kalio</p>

        <div className="group relative rounded-xl bg-base-300 text-base-content text-sm px-2.5 py-1.5 flex flex-col gap-1.5 w-full">
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
            <div className="max-w-[78ch]" data-testid="message-content">
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
});

