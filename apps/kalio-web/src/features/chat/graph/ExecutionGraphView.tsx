import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import {
  ArrowRight, BrainCircuit, MessageSquareText, Wrench, Zap,
} from 'lucide-react';
import type { Persona } from '@kalio/types';
import { useAgentStore } from '../../../store/agentStore';
import { useSessionStore } from '../../../store/sessionStore';
import { apiClient } from '../../../services/apiClient';
import {
  buildExecutionGraphModel,
} from './executionGraphModel';
import { ExecutionGraphBoard } from './ExecutionGraphBoard';
import { ExecutionGraphInspector } from './ExecutionGraphInspector';

function isLiveTool(activity: { status: string }): boolean {
  return activity.status === 'running' || activity.status === 'awaiting_confirmation';
}

function formatLoopLabel(
  loop: { sessionId: string; agentRun?: { label?: string } },
  sessionTitleById: Map<string, string>,
): string {
  return loop.agentRun?.label ?? sessionTitleById.get(loop.sessionId) ?? 'Agent run';
}

export function ExecutionGraphView() {
  const {
    activeSessionId,
    messages,
    agentTurns,
    sessions,
    sessionMessages,
    sessionAgentTurns,
    setActiveSession,
    setPendingMessage,
  } = useSessionStore();
  const { toolActivities, activeAgentLoops, pendingConfirmations, setPendingConfirmation } = useAgentStore();
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [zoom, setZoom] = useState(1);
  const [inspectorWidth, setInspectorWidth] = useState(384);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const inspectorResizeRef = useRef<{ startX: number; startWidth: number } | null>(null);

  useEffect(() => {
    apiClient
      .get<Persona[]>('/api/personas')
      .then((response) => setPersonas(response.data))
      .catch((err: unknown) => console.error('[ExecutionGraphView] personas load failed', err));
  }, []);

  useEffect(() => {
    const handleMouseMove = (event: globalThis.MouseEvent) => {
      const dragState = inspectorResizeRef.current;
      if (!dragState) {
        return;
      }

      const nextWidth = dragState.startWidth + (dragState.startX - event.clientX);
      setInspectorWidth(Math.max(280, Math.min(640, nextWidth)));
    };

    const stopResize = () => {
      inspectorResizeRef.current = null;
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', stopResize);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', stopResize);
    };
  }, []);

  const clampZoom = (value: number) => Math.max(0.55, Math.min(1.6, Number(value.toFixed(2))));
  const collapseTools = zoom <= 0.8;
  const decreaseZoom = () => setZoom((value) => clampZoom(value - 0.15));
  const increaseZoom = () => setZoom((value) => clampZoom(value + 0.15));
  const resetZoom = () => setZoom(1);
  const handleWheelZoom = (deltaY: number) => {
    if (deltaY === 0) {
      return;
    }

    setZoom((value) => clampZoom(value + (deltaY < 0 ? 0.15 : -0.15)));
  };
  const startInspectorResize = (event: ReactMouseEvent<HTMLDivElement>) => {
    inspectorResizeRef.current = {
      startX: event.clientX,
      startWidth: inspectorWidth,
    };
  };

  const runningLoops = Object.values(activeAgentLoops);
  const runningToolActivities = toolActivities.filter((activity) => isLiveTool(activity));
  const sessionTitleById = new Map(sessions.map((session) => [session.id, session.title]));
  const selectableSessions = sessions.filter((session) => session.kind !== 'subagent' && session.kind !== 'cli-agent');
  const activeSession = sessions.find((session) => session.id === activeSessionId) ?? null;
  const graphSurfaceClassName = 'flex-1 overflow-auto bg-[radial-gradient(circle_at_top,_rgba(56,189,248,0.08),_transparent_42%),linear-gradient(rgba(56,189,248,0.06)_1px,_transparent_1px),linear-gradient(90deg,_rgba(56,189,248,0.06)_1px,_transparent_1px)] bg-[length:100%_100%,40px_40px,40px_40px] bg-[#0a1220] p-6';

  const header = (
    <>
      <div className="px-5 py-4 border-b border-base-300 bg-base-100 flex flex-wrap items-start justify-between gap-4 shrink-0">
        <div>
          <h2 className="text-2xl font-black tracking-tight">Execution Graph</h2>
          <p className="text-sm text-base-content/45">Prompt roots, orchestration turns, tools, subagents, artifacts and final responses.</p>
        </div>

        <div className="flex flex-wrap items-center gap-2 justify-end">
          <button
            type="button"
            data-testid="graph-zoom-out"
            className="rounded-full border border-base-300 px-3 py-1.5 text-sm text-base-content/75 transition-colors hover:text-base-content"
            onClick={decreaseZoom}
          >
            -
          </button>
          <span className="rounded-full border border-sky-500/20 bg-sky-500/10 px-3 py-1.5 text-xs uppercase tracking-[0.22em] text-sky-300">
            {Math.round(zoom * 100)}%
          </span>
          <button
            type="button"
            data-testid="graph-zoom-in"
            className="rounded-full border border-base-300 px-3 py-1.5 text-sm text-base-content/75 transition-colors hover:text-base-content"
            onClick={increaseZoom}
          >
            +
          </button>
          <button
            type="button"
            data-testid="graph-zoom-reset"
            className="rounded-full border border-base-300 px-3 py-1.5 text-sm text-base-content/75 transition-colors hover:text-base-content"
            onClick={resetZoom}
          >
            Reset
          </button>
          <span className={`rounded-full border px-3 py-1.5 text-xs uppercase tracking-[0.22em] ${collapseTools ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200' : 'border-base-300 text-base-content/45'}`}>
            {collapseTools ? 'tools grouped' : 'tools expanded'}
          </span>
          <span className="rounded-full border border-base-300 px-3 py-1.5 text-xs uppercase tracking-[0.22em] text-base-content/45">
            drag to pan / wheel to zoom
          </span>
          <span className="rounded-full border border-base-300 px-3 py-1.5 text-xs uppercase tracking-[0.22em] text-base-content/45">
            {runningLoops.length} agent{runningLoops.length === 1 ? '' : 's'} live
          </span>
          <span className="rounded-full border border-base-300 px-3 py-1.5 text-xs uppercase tracking-[0.22em] text-base-content/45">
            {runningToolActivities.length} tool{runningToolActivities.length === 1 ? '' : 's'} active
          </span>
        </div>
      </div>

      {(runningLoops.length > 0 || runningToolActivities.length > 0) && (
        <div className="px-5 py-3 border-b border-base-300 bg-base-200/30 flex flex-wrap items-center gap-2 shrink-0">
          {runningLoops.map((loop) => (
            <div
              key={`${loop.sessionId}-${loop.turnId}`}
              className="inline-flex items-center gap-2 rounded-full border border-sky-500/20 bg-sky-500/10 px-3 py-1.5 text-xs text-sky-300"
            >
              <Zap size={12} className="shrink-0" />
              <span>{formatLoopLabel(loop, sessionTitleById)}</span>
            </div>
          ))}
          {runningToolActivities.slice(0, 4).map((activity) => (
            <div
              key={activity.callId}
              className="inline-flex items-center gap-2 rounded-full border border-amber-500/20 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-200"
            >
              <Wrench size={12} className="shrink-0" />
              <span>{activity.toolName}</span>
            </div>
          ))}
        </div>
      )}
    </>
  );

  const liveActivitySidebar = (
    <aside className="rounded-[28px] border border-base-300 bg-base-100/95 p-5 space-y-5 shadow-[0_20px_40px_rgba(2,12,27,0.22)]">
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <BrainCircuit size={16} className="text-sky-400" />
          <h4 className="text-xl font-black tracking-tight">Live agents</h4>
        </div>
        {runningLoops.length > 0 ? (
          <div className="space-y-2">
            {runningLoops.map((loop) => (
              <div key={`${loop.sessionId}-${loop.turnId}`} className="rounded-2xl border border-sky-500/15 bg-sky-500/8 px-4 py-3">
                <p className="text-sm font-semibold text-sky-300">{formatLoopLabel(loop, sessionTitleById)}</p>
                <p className="mt-1 text-xs text-base-content/60">{sessionTitleById.get(loop.sessionId) ?? loop.sessionId}</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-base-content/55">No active agent runs right now.</p>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Wrench size={16} className="text-amber-400" />
          <h4 className="text-xl font-black tracking-tight">Running tools</h4>
        </div>
        {runningToolActivities.length > 0 ? (
          <div className="space-y-2">
            {runningToolActivities.map((activity) => (
              <div key={activity.callId} className="rounded-2xl border border-amber-500/15 bg-amber-500/8 px-4 py-3">
                <p className="text-sm font-semibold text-amber-200">{activity.toolName}</p>
                <p className="mt-1 text-xs text-base-content/60">session {sessionTitleById.get(activity.sessionId ?? '') ?? 'active chat'}</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-base-content/55">No live tool calls yet.</p>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <MessageSquareText size={16} className="text-base-content/70" />
          <h4 className="text-xl font-black tracking-tight">Recent sessions</h4>
        </div>
        <div className="space-y-2">
          {sessions.slice(0, 4).map((session) => (
            <button
              key={session.id}
              type="button"
              aria-label={`Open recent session ${session.title}`}
              className="w-full rounded-2xl border border-base-300 bg-base-200/60 px-4 py-3 text-left transition-colors hover:bg-base-200"
              onClick={() => setActiveSession(session.id)}
            >
              <p className="text-sm font-medium text-base-content/90">{session.title}</p>
              <p className="mt-1 text-xs uppercase tracking-[0.2em] text-base-content/45">{session.kind === 'subagent' ? 'subagent session' : session.kind === 'cli-agent' ? 'cli agent session' : 'chat session'}</p>
            </button>
          ))}
        </div>
      </section>
    </aside>
  );

  if (!activeSessionId) {
    return (
      <div data-testid="execution-graph-view" className="flex h-full overflow-hidden bg-base-100">
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
          {header}

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
                      onClick={() => setActiveSession(session.id)}
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
        </div>
      </div>
    );
  }

  const model = buildExecutionGraphModel({
    sessionId: activeSessionId,
    messages,
    turns: agentTurns,
    toolActivities,
    activeAgentLoops,
    sessions,
    sessionMessages,
    sessionAgentTurns,
    personas,
    collapseTools,
  });

  const effectiveSelectedId = model.nodes.some((node) => node.id === selectedNodeId)
    ? selectedNodeId
    : model.defaultSelectedNodeId;
  const selectedNode = model.nodes.find((node) => node.id === effectiveSelectedId) ?? null;
  const selectedConfirmation = selectedNode?.payload.kind === 'tool' && selectedNode.payload.confirmationRequired
    ? pendingConfirmations[selectedNode.sessionId ?? activeSessionId ?? ''] ?? null
    : null;

  if (model.nodes.length === 0) {
    return (
      <div data-testid="execution-graph-view" className="flex h-full overflow-hidden bg-base-100">
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
          {header}

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
        </div>
      </div>
    );
  }

  return (
    <div data-testid="execution-graph-view" className="flex h-full overflow-hidden bg-base-100">
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
        {header}

        <ExecutionGraphBoard
          model={model}
          selectedNodeId={effectiveSelectedId}
          onSelectNode={setSelectedNodeId}
          zoom={zoom}
          onWheelZoom={handleWheelZoom}
        />
      </div>

      <div
        role="separator"
        aria-label="Resize graph inspector"
        data-testid="graph-inspector-resize-handle"
        className="w-2 shrink-0 cursor-col-resize bg-base-200/40 transition-colors hover:bg-sky-500/25"
        onMouseDown={startInspectorResize}
      />

      <ExecutionGraphInspector
        selectedNode={selectedNode}
        activeSessionId={activeSessionId}
        inspectorWidth={inspectorWidth}
        selectedConfirmation={selectedConfirmation}
        setActiveSession={setActiveSession}
        setPendingConfirmation={setPendingConfirmation}
        setPendingMessage={setPendingMessage}
      />
    </div>
  );
}
