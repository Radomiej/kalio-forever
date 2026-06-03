import { ArrowRight } from 'lucide-react';
import type { ChatSession } from '@kalio/types';
import type { ReactNode } from 'react';

export function ExecutionGraphNoSessionState({
  graphSurfaceClassName,
  liveActivitySidebar,
  selectableSessions,
  onSelectSession,
}: {
  graphSurfaceClassName: string;
  liveActivitySidebar: ReactNode;
  selectableSessions: ChatSession[];
  onSelectSession: (sessionId: string) => void;
}) {
  return (
    <div className={graphSurfaceClassName}>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <section className="rounded-[28px] border border-sky-500/15 bg-[#101b2d]/92 p-6 text-sky-50 shadow-[0_25px_45px_rgba(2,12,27,0.35)]">
          <div className="max-w-3xl">
            <p className="text-[11px] uppercase tracking-[0.3em] text-sky-200/65">Execution overview</p>
            <h3 className="mt-3 text-3xl font-black tracking-tight">Pick a session or inspect live activity</h3>
            <p className="mt-3 text-sm text-sky-100/70">
              Graph mode now stays useful before a session is focused: you can jump into recent sessions, inspect running agents,
              and see which tools are currently executing.
            </p>
          </div>

          <div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {selectableSessions.map((session) => (
              <button
                key={session.id}
                type="button"
                aria-label={`Open session ${session.title} from graph overview`}
                className="rounded-[22px] border border-sky-400/20 bg-sky-500/8 px-4 py-4 text-left transition-all hover:border-sky-300/40 hover:bg-sky-500/14"
                onClick={() => onSelectSession(session.id)}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-lg font-semibold text-sky-50">{session.title}</p>
                    <p className="mt-1 text-xs uppercase tracking-[0.24em] text-sky-200/60">session</p>
                  </div>
                  <ArrowRight size={16} className="mt-1 text-sky-200/70 shrink-0" />
                </div>
                <p className="mt-4 text-xs text-sky-100/60">updated {new Date(session.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
              </button>
            ))}
          </div>

          {selectableSessions.length === 0 && (
            <div className="mt-8 rounded-[22px] border border-dashed border-sky-400/20 px-5 py-6 text-sm text-sky-100/60">
              No root chat sessions yet. Create or select one in Conversations to start building the graph.
            </div>
          )}
        </section>

        {liveActivitySidebar}
      </div>
    </div>
  );
}

export function ExecutionGraphNoNodesState({
  activeSession,
  graphSurfaceClassName,
  liveActivitySidebar,
}: {
  activeSession: ChatSession | null;
  graphSurfaceClassName: string;
  liveActivitySidebar: ReactNode;
}) {
  return (
    <div className={graphSurfaceClassName}>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <section className="rounded-[28px] border border-sky-500/15 bg-[#101b2d]/92 p-6 text-sky-50 shadow-[0_25px_45px_rgba(2,12,27,0.35)]">
          <p className="text-[11px] uppercase tracking-[0.3em] text-sky-200/65">Selected session</p>
          <h3 className="mt-3 text-3xl font-black tracking-tight">No execution nodes yet for this session.</h3>
          <p className="mt-3 text-sm text-sky-100/70">
            {activeSession
              ? `Session "${activeSession.title}" is active in Graph view, but nothing has executed yet.`
              : 'This session is active in Graph view, but nothing has executed yet.'}
          </p>
          <p className="mt-3 text-sm text-sky-100/70">
            You do not need to start in Graph. Send the first message in Conversation or stay here and switch back later. The graph will populate from the same Talk session state.
          </p>
          <div className="mt-6 rounded-[22px] border border-dashed border-sky-400/20 px-5 py-5 text-sm text-sky-100/65">
            The first prompt, tool call, subagent branch, or final answer will appear here as soon as the session starts producing execution data.
          </div>
        </section>

        {liveActivitySidebar}
      </div>
    </div>
  );
}
