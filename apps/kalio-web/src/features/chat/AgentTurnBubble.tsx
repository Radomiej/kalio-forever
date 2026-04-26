import { useEffect, useRef, useState } from 'react';
import { BrainCircuit, ChevronDown } from 'lucide-react';
import { useSessionStore } from '../../store/sessionStore';
import { useAgentStore } from '../../store/agentStore';
import { MarkdownViewer } from '../../components/markdown/MarkdownViewer';
import type { AgentTurn } from '../../store/sessionStore';
import type { ToolActivity } from '../../store/agentStore';
import { LiveToolCallBubble, HistoryToolCallBubble } from './ToolCallBubble';

interface Props {
  turn: AgentTurn;
  toolActivities: ToolActivity[];
  answeredCallIds?: Set<string>;
}

// ─── ThinkingBlock ────────────────────────────────────────────────────────────

function ThinkingBlock({ content, isStreaming }: { content: string; isStreaming: boolean }) {
  const [open, setOpen] = useState(false);
  const didAutoOpen = useRef(false);

  useEffect(() => {
    if (isStreaming && content.length > 0 && !didAutoOpen.current) {
      didAutoOpen.current = true;
      setOpen(true);
    }
    if (!isStreaming) didAutoOpen.current = false;
  }, [isStreaming, content.length]);

  return (
    <div className="border border-base-content/10 rounded-lg overflow-hidden">
      <button
        className="flex items-center gap-2 w-full px-3 py-2 text-xs text-base-content/50 hover:text-base-content/70 transition-colors bg-base-200/50"
        onClick={() => setOpen((v) => !v)}
      >
        <BrainCircuit size={12} className={isStreaming ? 'text-sky-400 animate-pulse' : 'text-base-content/40'} />
        <span>Thinking</span>
        {isStreaming && <span className="loading loading-dots loading-xs ml-1" />}
        <ChevronDown size={12} className={`ml-auto transition-transform duration-150 ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="px-3 py-2 text-xs text-base-content/50 font-mono whitespace-pre-wrap max-h-60 overflow-y-auto bg-base-200/20">
          {content}
          {isStreaming && <span className="inline-block h-3 w-0.5 animate-pulse bg-current ml-0.5" />}
        </div>
      )}
    </div>
  );
}

// ─── AgentTurnBubble ──────────────────────────────────────────────────────────

export function AgentTurnBubble({ turn, toolActivities, answeredCallIds }: Props) {
  const { messages, streamingChunks, thinkingChunks } = useSessionStore();
  const { callIdToName: persistentCallIdToName } = useAgentStore();

  // Build callId → toolName from all available sources
  const toolCallIdToName = new Map<string, string>(Object.entries(persistentCallIdToName));
  for (const msg of messages) {
    if (msg.role === 'assistant' && msg.toolCalls) {
      for (const tc of msg.toolCalls) toolCallIdToName.set(tc.id, tc.name);
    }
  }
  for (const a of toolActivities) toolCallIdToName.set(a.callId, a.toolName);

  // Build tool result lookup by callId
  const toolResultByCallId = new Map<string, { content: string; status: string }>();
  for (const msg of messages) {
    if (msg.role === 'tool_result' && msg.toolCallId) {
      toolResultByCallId.set(msg.toolCallId, { content: msg.content, status: 'success' });
    }
  }

  return (
    <div data-testid="agent-turn-bubble" className="flex justify-start mb-2 w-full">
      <div className="min-w-0 w-full max-w-[min(100%,68rem)]">
        <p className="text-xs text-base-content/50 mb-1 ml-1">Kalio</p>

        <div className="group relative rounded-2xl bg-base-300 text-base-content text-sm px-4 py-3 flex flex-col gap-2 w-full">
          {turn.items.map((item, idx) => {
            if (item.kind === 'tool') {
              const callId = item.callId;
              const toolName = toolCallIdToName.get(callId) ?? callId;
              const toolResult = toolResultByCallId.get(callId);
              const isAnswered = answeredCallIds?.has(callId) ?? false;
              
              // Check if this is a live (in-progress) tool or completed
              const liveActivity = toolActivities.find((a) => a.callId === callId);
              
              if (liveActivity && !toolResult) {
                // Live tool call (still running)
                return <LiveToolCallBubble key={`${callId}-${idx}`} activity={liveActivity} />;
              }
              
              // Completed tool call
              return (
                <HistoryToolCallBubble
                  key={`${callId}-${idx}`}
                  toolName={toolName}
                  content={toolResult?.content ?? ''}
                  isAnswered={isAnswered}
                />
              );
            }

            if (item.kind === 'thinking') {
              const messageId = item.messageId;
              const thinkingContent = thinkingChunks[messageId] ?? '';
              if (!thinkingContent) return null;
              return <ThinkingBlock key={`think-${messageId}`} content={thinkingContent} isStreaming={!turn.done} />;
            }

            // text item
            const messageId = item.messageId;
            const msg = messages.find((m) => m.id === messageId);
            if (!msg) return null;
            
            const isStreaming = msg.streaming === true;
            const displayContent = isStreaming ? (streamingChunks[messageId] ?? '') : msg.content;

            return (
              <div key={`text-${messageId}`} className="flex flex-col gap-2">
                {isStreaming && !displayContent ? (
                  <span data-testid="streaming-indicator" className="loading loading-dots loading-xs" />
                ) : displayContent ? (
                  <div>
                    <MarkdownViewer content={displayContent} />
                    {isStreaming && <span className="ml-0.5 inline-block h-3.5 w-0.5 animate-pulse bg-current" />}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
