import { BrainCircuit, MessageSquareText, Wrench } from 'lucide-react';
import type { ChatSession } from '@kalio/types';
import type { ToolActivity } from '../../../store/agentStore';

export function isLiveTool(activity: { status: string }): boolean {
  return activity.status === 'running' || activity.status === 'awaiting_confirmation';
}

export function formatSidebarLoopLabel(
  loop: { sessionId: string; agentRun?: { label?: string } },
  sessionTitleById: Map<string, string>,
): string {
  return loop.agentRun?.label ?? sessionTitleById.get(loop.sessionId) ?? 'Agent run';
}

export function ExecutionGraphLiveSidebar({
  runningLoops,
  runningToolActivities,
  sessions,
  sessionTitleById,
  onSelectSession,
}: {
  runningLoops: Array<{ sessionId: string; turnId: string; agentRun?: { label?: string } }>;
  runningToolActivities: ToolActivity[];
  sessions: ChatSession[];
  sessionTitleById: Map<string, string>;
  onSelectSession: (sessionId: string) => void;
}) {
  return (
    <aside className="rounded-xl border border-base-300 bg-base-100/95 p-3 space-y-3 shadow-[0_12px_28px_rgba(2,12,27,0.18)]">
      <section className="space-y-2">
        <div className="flex items-center gap-2">
          <BrainCircuit size={14} className="text-sky-400" />
          <h4 className="text-sm font-semibold tracking-tight">Live agents</h4>
        </div>
        {runningLoops.length > 0 ? (
          <div className="space-y-2">
            {runningLoops.map((loop) => (
              <div key={`${loop.sessionId}-${loop.turnId}`} className="rounded-lg border border-sky-500/15 bg-sky-500/8 px-3 py-2">
                <p className="text-xs font-semibold text-sky-300">{formatSidebarLoopLabel(loop, sessionTitleById)}</p>
                <p className="mt-1 text-xs text-base-content/60">{sessionTitleById.get(loop.sessionId) ?? loop.sessionId}</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-base-content/55">No active agent runs right now.</p>
        )}
      </section>

      <section className="space-y-2">
        <div className="flex items-center gap-2">
          <Wrench size={14} className="text-amber-400" />
          <h4 className="text-sm font-semibold tracking-tight">Running tools</h4>
        </div>
        {runningToolActivities.length > 0 ? (
          <div className="space-y-2">
            {runningToolActivities.map((activity) => (
              <div key={activity.callId} className="rounded-lg border border-amber-500/15 bg-amber-500/8 px-3 py-2">
                <p className="text-xs font-semibold text-amber-200">{activity.toolName}</p>
                <p className="mt-1 text-xs text-base-content/60">session {sessionTitleById.get(activity.sessionId ?? '') ?? 'active chat'}</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-base-content/55">No live tool calls yet.</p>
        )}
      </section>

      <section className="space-y-2">
        <div className="flex items-center gap-2">
          <MessageSquareText size={14} className="text-base-content/70" />
          <h4 className="text-sm font-semibold tracking-tight">Recent sessions</h4>
        </div>
        <div className="space-y-2">
          {sessions.slice(0, 4).map((session) => (
            <button
              key={session.id}
              type="button"
              aria-label={`Open recent session ${session.title}`}
              className="w-full rounded-lg border border-base-300 bg-base-200/60 px-3 py-2 text-left transition-colors hover:bg-base-200"
              onClick={() => onSelectSession(session.id)}
            >
              <p className="text-xs font-medium text-base-content/90">{session.title}</p>
              <p className="mt-1 text-[10px] uppercase tracking-[0.14em] text-base-content/45">{session.kind === 'subagent' ? 'subagent session' : session.kind === 'cli-agent' ? 'cli agent session' : 'chat session'}</p>
            </button>
          ))}
        </div>
      </section>
    </aside>
  );
}
