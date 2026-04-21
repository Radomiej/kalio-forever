import { BotMessageSquare, Zap } from 'lucide-react';
import { useAgentStore } from '../../store/agentStore';
import { ToolActivityRow } from '../chat/ToolActivityRow';

export function ConversationManagerPanel({ onNavigate }: { onNavigate?: () => void }) {
  const isStreaming = useAgentStore((s) => s.isStreaming);
  const toolActivities = useAgentStore((s) => s.toolActivities);

  const active = toolActivities.filter(
    (a) => a.status === 'running' || a.status === 'awaiting_confirmation',
  );
  const done = toolActivities.filter(
    (a) => a.status !== 'running' && a.status !== 'awaiting_confirmation',
  );

  if (!isStreaming && toolActivities.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 text-base-content/30 p-4">
        <BotMessageSquare size={28} />
        <p className="text-xs text-center">No active agent runs.<br />Start a chat to see live tool calls here.</p>
        <button className="btn btn-ghost btn-xs mt-2" onClick={onNavigate}>Go to chat</button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Status bar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-base-300 shrink-0">
        {isStreaming ? (
          <>
            <Zap size={12} className="text-sky-400 animate-pulse" />
            <span className="text-xs text-sky-400 font-medium">Agent running</span>
          </>
        ) : (
          <>
            <Zap size={12} className="text-base-content/30" />
            <span className="text-xs text-base-content/40">Last run</span>
          </>
        )}
        <span className="ml-auto text-xs text-base-content/30">{toolActivities.length} call{toolActivities.length !== 1 ? 's' : ''}</span>
      </div>

      {/* Active tool calls */}
      <div className="flex-1 overflow-y-auto px-2 py-2 flex flex-col gap-1">
        {active.map((a) => (
          <ToolActivityRow key={a.callId} activity={a} />
        ))}
        {done.length > 0 && active.length > 0 && (
          <div className="border-t border-base-300/40 my-1" />
        )}
        {done.map((a) => (
          <ToolActivityRow key={a.callId} activity={a} />
        ))}
      </div>
    </div>
  );
}

