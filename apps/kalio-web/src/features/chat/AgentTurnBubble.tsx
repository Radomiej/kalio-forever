import { useEffect, useRef } from 'react';
import { BrainCircuit, ChevronDown } from 'lucide-react';
import { useSessionStore } from '../../store/sessionStore';
import { useAgentStore } from '../../store/agentStore';
import { MarkdownViewer } from '../../components/markdown/MarkdownViewer';
import type { ChatMessage } from '@kalio/types';
import type { ToolActivity } from '../../store/agentStore';
import { LiveToolCallBubble, HistoryToolCallBubble } from './ToolCallBubble';
import { useState } from 'react';

interface Props {
  /** All consecutive non-user messages belonging to this agent turn, in order. */
  messages: ChatMessage[];
  /** Live tool activities — only pass for the currently active turn. */
  toolActivities: ToolActivity[];
  /** Set of toolCallIds for which the user has already submitted an answer. */
  answeredCallIds?: Set<string>;
}

/** Per-message thinking bubble with independent open/close state. */
function ThinkingBlock({ content, isStreaming }: { content: string; isStreaming: boolean }) {
  const [open, setOpen] = useState(false);
  const didAutoOpen = useRef(false);

  useEffect(() => {
    if (isStreaming && content.length > 0 && !didAutoOpen.current) {
      didAutoOpen.current = true;
      setOpen(true);
    }
    if (!isStreaming) {
      didAutoOpen.current = false;
    }
  }, [isStreaming, content.length]);

  return (
    <div className="border border-base-content/10 rounded-lg overflow-hidden">
      <button
        className="flex items-center gap-2 w-full px-3 py-2 text-xs text-base-content/50 hover:text-base-content/70 transition-colors bg-base-200/50"
        onClick={() => setOpen((v) => !v)}
      >
        <BrainCircuit
          size={12}
          className={isStreaming ? 'text-sky-400 animate-pulse' : 'text-base-content/40'}
        />
        <span>Thinking</span>
        {isStreaming && <span className="loading loading-dots loading-xs ml-1" />}
        <ChevronDown
          size={12}
          className={`ml-auto transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && (
        <div className="px-3 py-2 text-xs text-base-content/50 font-mono whitespace-pre-wrap max-h-60 overflow-y-auto bg-base-200/20">
          {content}
          {isStreaming && (
            <span className="inline-block h-3 w-0.5 animate-pulse bg-current ml-0.5" />
          )}
        </div>
      )}
    </div>
  );
}

export function AgentTurnBubble({ messages, toolActivities, answeredCallIds }: Props) {
  const { streamingChunks, thinkingChunks } = useSessionStore();
  const { callIdToName: persistentCallIdToName } = useAgentStore();

  // Build callId → toolName map
  const toolCallIdToName = new Map<string, string>(Object.entries(persistentCallIdToName));
  for (const msg of messages) {
    if (msg.role === 'assistant' && msg.toolCalls) {
      for (const tc of msg.toolCalls) {
        toolCallIdToName.set(tc.id, tc.name);
      }
    }
  }
  for (const a of toolActivities) {
    toolCallIdToName.set(a.callId, a.toolName);
  }

  // tool_result messages already represented in the messages array
  const renderedCallIds = new Set(
    messages.filter((m) => m.role === 'tool_result' && m.toolCallId).map((m) => m.toolCallId!),
  );

  // Live activities not yet represented in messages
  const pendingActivities = toolActivities.filter((a) => !renderedCallIds.has(a.callId));

  return (
    <div data-testid="agent-turn-bubble" className="flex justify-start mb-2 w-full">
      <div className="min-w-0 w-full max-w-[min(100%,68rem)]">
        <p className="text-xs text-base-content/50 mb-1 ml-1">Kalio</p>

        <div className="group relative rounded-2xl bg-base-300 text-base-content text-sm px-4 py-3 flex flex-col gap-2 w-full">
          {/* Render each message in order: per-message thinking bubble → content/tool chips */}
          {messages.map((msg) => {
            if (msg.role === 'tool_result') {
              const toolName = msg.toolCallId
                ? (toolCallIdToName.get(msg.toolCallId) ?? msg.toolCallId)
                : 'tool';
              return (
                <HistoryToolCallBubble
                  key={msg.id}
                  toolName={toolName}
                  content={msg.content}
                  isAnswered={msg.toolCallId ? (answeredCallIds?.has(msg.toolCallId) ?? false) : false}
                />
              );
            }

            if (msg.role !== 'assistant') return null;

            const isStreaming = msg.streaming === true;
            const displayContent = isStreaming ? (streamingChunks[msg.id] ?? '') : msg.content;
            const thinkingContent = thinkingChunks[msg.id] || msg.thinking || '';

            return (
              <div key={msg.id} className="flex flex-col gap-2">
                {/* Per-message thinking bubble — only shown when this message has thinking */}
                {thinkingContent.length > 0 && (
                  <ThinkingBlock content={thinkingContent} isStreaming={isStreaming} />
                )}

                {/* Message content */}
                {isStreaming && !displayContent && !thinkingContent ? (
                  <span
                    data-testid="streaming-indicator"
                    className="loading loading-dots loading-xs"
                  />
                ) : displayContent ? (
                  <div>
                    <MarkdownViewer content={displayContent} />
                    {isStreaming && (
                      <span className="ml-0.5 inline-block h-3.5 w-0.5 animate-pulse bg-current" />
                    )}
                  </div>
                ) : null}
              </div>
            );
          })}

          {/* Live activities not yet committed as tool_result messages */}
          {pendingActivities.map((activity) => (
            <LiveToolCallBubble key={activity.callId} activity={activity} />
          ))}
        </div>
      </div>
    </div>
  );
}
