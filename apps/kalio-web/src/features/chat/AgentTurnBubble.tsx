import { useEffect, useRef, useState } from 'react';
import { BrainCircuit, ChevronDown } from 'lucide-react';
import { useSessionStore } from '../../store/sessionStore';
import { useAgentStore } from '../../store/agentStore';
import { MarkdownViewer } from '../../components/markdown/MarkdownViewer';
import type { ChatMessage } from '@kalio/types';
import type { ToolActivity } from '../../store/agentStore';
import { LiveToolCallBubble, HistoryToolCallBubble } from './ToolCallBubble';

interface Props {
  messages: ChatMessage[];
  toolActivities: ToolActivity[];
  answeredCallIds?: Set<string>;
}

// ─── Unified chronological item ───────────────────────────────────────────────
// Each item is either an assistant message, a tool call (live or history), or
// a thinking block. Tool calls are keyed by callId so live→history transition
// happens in-place without position change.

type Item =
  | { kind: 'assistant'; msg: ChatMessage }
  | { kind: 'tool_live'; activity: ToolActivity; order: number }
  | { kind: 'tool_history'; msg: ChatMessage; toolName: string; isAnswered: boolean; order: number };

function buildItems(
  messages: ChatMessage[],
  toolActivities: ToolActivity[],
  toolCallIdToName: Map<string, string>,
  answeredCallIds: Set<string> | undefined,
): Item[] {
  // Map callId → order (position when tool:start arrived, preserved across transition)
  const activityOrder = new Map<string, number>(
    toolActivities.map((a, i) => [a.callId, i]),
  );

  // Which callIds already have a tool_result message
  const historyCallIds = new Set(
    messages.filter((m) => m.role === 'tool_result' && m.toolCallId).map((m) => m.toolCallId!),
  );

  const items: Item[] = [];

  for (const msg of messages) {
    if (msg.role === 'assistant') {
      items.push({ kind: 'assistant', msg });
    } else if (msg.role === 'tool_result' && msg.toolCallId) {
      const toolName = toolCallIdToName.get(msg.toolCallId) ?? msg.toolCallId;
      const isAnswered = answeredCallIds?.has(msg.toolCallId) ?? false;
      // order: use activity order if known, else append after current items
      const order = activityOrder.get(msg.toolCallId) ?? items.length;
      items.push({ kind: 'tool_history', msg, toolName, isAnswered, order });
    }
  }

  // Append live activities whose tool_result message hasn't arrived yet
  for (const activity of toolActivities) {
    if (!historyCallIds.has(activity.callId)) {
      items.push({ kind: 'tool_live', activity, order: activityOrder.get(activity.callId) ?? items.length });
    }
  }

  // Sort: assistant messages keep their natural insertion order (stable),
  // tool items are sorted by their activity order within the turn.
  // Simple approach: tool items inserted after the last assistant msg before them.
  // Since messages[] is already chronological and live activities append naturally,
  // we just stable-sort tool items by order, keeping assistant messages in place.
  // Actually: the items array is already in correct order (messages in sequence,
  // live appended after). Re-sort only tool items relative to each other.
  // Simplest correct approach: items from messages are in order, live items appended.
  // For full chronology we sort the whole list by a sequence number:
  const sequenced = items.map((item, idx) => {
    if (item.kind === 'assistant') return { item, seq: idx * 1000 };
    if (item.kind === 'tool_history') return { item, seq: item.order * 1000 + 1 };
    return { item, seq: item.order * 1000 + 1 };
  });
  sequenced.sort((a, b) => a.seq - b.seq);
  return sequenced.map((s) => s.item);
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

export function AgentTurnBubble({ messages, toolActivities, answeredCallIds }: Props) {
  const { streamingChunks, thinkingChunks } = useSessionStore();
  const { callIdToName: persistentCallIdToName } = useAgentStore();

  // Build callId → toolName from all available sources
  const toolCallIdToName = new Map<string, string>(Object.entries(persistentCallIdToName));
  for (const msg of messages) {
    if (msg.role === 'assistant' && msg.toolCalls) {
      for (const tc of msg.toolCalls) toolCallIdToName.set(tc.id, tc.name);
    }
  }
  for (const a of toolActivities) toolCallIdToName.set(a.callId, a.toolName);

  const items = buildItems(messages, toolActivities, toolCallIdToName, answeredCallIds);

  return (
    <div data-testid="agent-turn-bubble" className="flex justify-start mb-2 w-full">
      <div className="min-w-0 w-full max-w-[min(100%,68rem)]">
        <p className="text-xs text-base-content/50 mb-1 ml-1">Kalio</p>

        <div className="group relative rounded-2xl bg-base-300 text-base-content text-sm px-4 py-3 flex flex-col gap-2 w-full">
          {items.map((item) => {
            if (item.kind === 'tool_live') {
              return <LiveToolCallBubble key={item.activity.callId} activity={item.activity} />;
            }

            if (item.kind === 'tool_history') {
              return (
                <HistoryToolCallBubble
                  key={item.msg.id}
                  toolName={item.toolName}
                  content={item.msg.content}
                  isAnswered={item.isAnswered}
                />
              );
            }

            // assistant message
            const msg = item.msg;
            const isStreaming = msg.streaming === true;
            const displayContent = isStreaming ? (streamingChunks[msg.id] ?? '') : msg.content;
            const thinkingContent = thinkingChunks[msg.id] || msg.thinking || '';

            return (
              <div key={msg.id} className="flex flex-col gap-2">
                {thinkingContent.length > 0 && (
                  <ThinkingBlock content={thinkingContent} isStreaming={isStreaming} />
                )}
                {isStreaming && !displayContent && !thinkingContent ? (
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
