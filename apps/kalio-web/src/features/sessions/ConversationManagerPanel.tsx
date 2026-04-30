import { BotMessageSquare, Zap, Brain, StopCircle } from 'lucide-react';
import { useAgentStore } from '../../store/agentStore';
import type { LlmActivity } from '../../store/agentStore';
import { ToolActivityRow } from '../chat/ToolActivityRow';
import { useSessionStore } from '../../store/sessionStore';
import { eventBus } from '../../services/eventBus';

export function ConversationManagerPanel({ onNavigate }: { onNavigate?: () => void }) {
  const isStreaming = useAgentStore((s) => s.isStreaming);
  const toolActivities = useAgentStore((s) => s.toolActivities);
  const llmActivities = useAgentStore((s) => s.llmActivities);
  const activeAgentLoops = useAgentStore((s) => s.activeAgentLoops);
  const sessions = useSessionStore((s) => s.sessions);

  const runningLoops = Object.values(activeAgentLoops);
  const active = toolActivities.filter(
    (a) => a.status === 'running' || a.status === 'awaiting_confirmation',
  );
  const done = toolActivities.filter(
    (a) => a.status !== 'running' && a.status !== 'awaiting_confirmation',
  );

  const isEmpty = runningLoops.length === 0 && !isStreaming && toolActivities.length === 0 && llmActivities.length === 0;

  if (isEmpty) {
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
      {/* Active LLM sessions */}
      {runningLoops.length > 0 && (
        <div className="px-2 pt-2 pb-1 flex flex-col gap-1 shrink-0">
          <p className="text-[10px] uppercase tracking-wider text-base-content/30 px-2 pb-0.5">Running sessions</p>
          {runningLoops.map((loop) => {
            const session = sessions.find((s) => s.id === loop.sessionId);
            return (
              <div
                key={loop.sessionId}
                className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-sky-500/10 border border-sky-500/20 text-xs"
                data-testid={`active-loop-${loop.sessionId}`}
              >
                <Zap size={11} className="text-sky-400 animate-pulse shrink-0" />
                <span className="flex-1 truncate text-sky-300">
                  {session?.title ?? loop.sessionId}
                </span>
                <button
                  className="btn btn-xs btn-ghost text-error hover:text-error p-0.5"
                  title="Stop agent"
                  onClick={() => eventBus.stopTurn(loop.sessionId)}
                  data-testid={`stop-loop-${loop.sessionId}`}
                >
                  <StopCircle size={13} />
                </button>
              </div>
            );
          })}
          {(active.length > 0 || done.length > 0 || llmActivities.length > 0) && (
            <div className="border-t border-base-300/40 mt-1" />
          )}
        </div>
      )}

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
        <span className="ml-auto text-xs text-base-content/30">{toolActivities.length} call{toolActivities.length !== 1 ? 's' : ''}{llmActivities.length > 0 ? ` · ${llmActivities.length} llm` : ''}</span>
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
        {llmActivities.length > 0 && (
          <>
            {(active.length > 0 || done.length > 0) && <div className="border-t border-base-300/40 my-1" />}
            {llmActivities.map((a) => (
              <LlmActivityRow key={a.id} activity={a} />
            ))}
          </>
        )}
      </div>
    </div>
  );
}

function LlmActivityRow({ activity }: { activity: LlmActivity }) {
  const statusColor =
    activity.status === 'running' ? 'text-sky-400' :
    activity.status === 'error' ? 'text-error' :
    'text-base-content/40';
  return (
    <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-base-300/30 text-xs">
      <Brain size={11} className={`shrink-0 ${activity.status === 'running' ? 'animate-pulse text-sky-400' : 'text-base-content/30'}`} />
      <span className={`flex-1 truncate ${statusColor}`}>{activity.label}</span>
      {activity.status === 'running' && (
        <span className="loading loading-dots loading-xs shrink-0" />
      )}
      {activity.status === 'done' && <span className="text-success text-[10px] shrink-0">✓</span>}
      {activity.status === 'error' && <span className="text-error text-[10px] shrink-0">✗</span>}
    </div>
  );
}

