import { useState } from 'react';
import { BrainCircuit, ChevronDown } from 'lucide-react';
import { useSessionStore } from '../../store/sessionStore';
import { useAgentStore } from '../../store/agentStore';
import { MarkdownViewer } from '../../components/markdown/MarkdownViewer';
import type { ChatMessage } from '@kalio/types';
import type { ToolActivity } from '../../store/agentStore';
import { LiveToolCallBubble, HistoryToolCallBubble } from './ToolCallBubble';

interface Props {
  /** All consecutive non-user messages belonging to this agent turn, in order. */
  messages: ChatMessage[];
  /** Live tool activities — only pass for the currently active turn. */
  toolActivities: ToolActivity[];
  /** Set of toolCallIds for which the user has already submitted an answer. */
  answeredCallIds?: Set<string>;
}

export function AgentTurnBubble({ messages, toolActivities, answeredCallIds }: Props) {
  const { streamingChunks, thinkingChunks } = useSessionStore();
  const { callIdToName: persistentCallIdToName } = useAgentStore();
  const [thinkingOpen, setThinkingOpen] = useState(false);

  // Build callId → toolName map from assistant messages' toolCalls arrays (loaded from DB),
  // live toolActivities (current turn), and the persistent map (all prior turns in session).
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

  // Live activities not yet represented in messages (still running / just finished before message added)
  const pendingActivities = toolActivities.filter((a) => !renderedCallIds.has(a.callId));

  // Aggregate thinking content from all assistant messages in this turn
  const thinkingContent = messages
    .filter((m) => m.role === 'assistant')
    .map((m) => thinkingChunks[m.id] ?? '')
    .filter(Boolean)
    .join('\n');

  const isAnyStreaming = messages.some((m) => m.streaming === true);

  return (
    <div data-testid="agent-turn-bubble" className="flex justify-start mb-2 w-full">
      <div className="min-w-0 w-full max-w-[min(100%,68rem)]">
        <p className="text-xs text-base-content/50 mb-1 ml-1">Kalio</p>

        <div className="group relative rounded-2xl bg-base-300 text-base-content text-sm px-4 py-3 flex flex-col gap-2 w-full">
          {/* Thinking block — collapsed by default */}
          {thinkingContent.length > 0 && (
            <div className="border border-base-content/10 rounded-lg overflow-hidden">
              <button
                className="flex items-center gap-2 w-full px-3 py-2 text-xs text-base-content/50 hover:text-base-content/70 transition-colors bg-base-200/50"
                onClick={() => setThinkingOpen((v) => !v)}
              >
                <BrainCircuit
                  size={12}
                  className={isAnyStreaming ? 'text-sky-400 animate-pulse' : 'text-base-content/40'}
                />
                <span>Thinking</span>
                {isAnyStreaming && <span className="loading loading-dots loading-xs ml-1" />}
                <ChevronDown
                  size={12}
                  className={`ml-auto transition-transform duration-150 ${thinkingOpen ? 'rotate-180' : ''}`}
                />
              </button>
              {thinkingOpen && (
                <div className="px-3 py-2 text-xs text-base-content/50 font-mono whitespace-pre-wrap max-h-60 overflow-y-auto bg-base-200/20">
                  {thinkingContent}
                </div>
              )}
            </div>
          )}

          {/* Messages in order: assistant text + tool_result chips interleaved */}
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

            if (!displayContent && !isStreaming) return null;

            return (
              <div key={msg.id}>
                {isStreaming && !displayContent ? (
                  <span
                    data-testid="streaming-indicator"
                    className="loading loading-dots loading-xs"
                  />
                ) : (
                  <>
                    <MarkdownViewer content={displayContent} />
                    {isStreaming && (
                      <span className="ml-0.5 inline-block h-3.5 w-0.5 animate-pulse bg-current" />
                    )}
                  </>
                )}
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
