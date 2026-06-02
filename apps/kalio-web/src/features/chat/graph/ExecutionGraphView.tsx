import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import {
  ArrowRight, BrainCircuit, MessageSquareText, Wrench,
} from 'lucide-react';
import type { ArchitectureGraphProjection, ChatMessage, Persona } from '@kalio/types';
import { useAgentStore } from '../../../store/agentStore';
import { useSessionStore } from '../../../store/sessionStore';
import { apiClient } from '../../../services/apiClient';
import { buildTurnsFromHistory } from '../chatUtils';
import {
  buildExecutionGraphModel,
} from './executionGraphModel';
import { ExecutionGraphBoard, type GraphCardDensity } from './ExecutionGraphBoard';
import { ExecutionGraphHeader } from './ExecutionGraphHeader';
import { ExecutionGraphInspector } from './ExecutionGraphInspector';
import { focusExecutionGraphMessages, type ExecutionGraphFocusMode } from './executionGraphFocus';
import { extractArchitectureBranchSessionIds, extractExecutionGraphHydrationStatus } from './executionGraphHydration';
import { architectureRunIdFromRootSession, buildArchitectureRootGraphModel } from './executionGraphArchitectureRoot';

const DEFAULT_GRAPH_ZOOM = 0.82;
const DEFAULT_INSPECTOR_WIDTH = 320;

function isLiveTool(activity: { status: string }): boolean {
  return activity.status === 'running' || activity.status === 'awaiting_confirmation';
}

function formatSidebarLoopLabel(
  loop: { sessionId: string; agentRun?: { label?: string } },
  sessionTitleById: Map<string, string>,
): string {
  return loop.agentRun?.label ?? sessionTitleById.get(loop.sessionId) ?? 'Agent run';
}

interface ExecutionGraphViewProps {
  onOpenSessionInConversation?: (sessionId: string) => void;
}

export function ExecutionGraphView({ onOpenSessionInConversation }: ExecutionGraphViewProps = {}) {
  const {
    activeSessionId,
    messages,
    agentTurns,
    sessions,
    sessionMessages,
    sessionAgentTurns,
    setActiveSession,
    setMessages,
    setAgentTurns,
    setPendingMessage,
  } = useSessionStore();
  const { toolActivities, activeAgentLoops, pendingConfirmations, setPendingConfirmation } = useAgentStore();
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [zoom, setZoom] = useState(DEFAULT_GRAPH_ZOOM);
  const [inspectorWidth, setInspectorWidth] = useState(DEFAULT_INSPECTOR_WIDTH);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [focusMode, setFocusMode] = useState<ExecutionGraphFocusMode>('latest-architecture');
  const [cardDensity, setCardDensity] = useState<GraphCardDensity>('compact');
  const [architectureRootGraph, setArchitectureRootGraph] = useState<ArchitectureGraphProjection | null>(null);
  const inspectorResizeRef = useRef<{ startX: number; startWidth: number } | null>(null);

  useEffect(() => {
    apiClient
      .get<Persona[]>('/api/personas')
      .then((response) => setPersonas(response.data))
      .catch((err: unknown) => console.error('[ExecutionGraphView] personas load failed', err));
  }, []);

  useEffect(() => {
    if (!activeSessionId) {
      return;
    }

    const hydratedMessages = sessionMessages[activeSessionId] ?? messages;
    if (hydratedMessages.length > 0) {
      return;
    }

    let cancelled = false;
    apiClient
      .get<ChatMessage[]>(`/api/sessions/${activeSessionId}/messages`)
      .then((response) => {
        if (cancelled) {
          return;
        }
        setMessages(response.data, activeSessionId);
        setAgentTurns(buildTurnsFromHistory(response.data, activeSessionId), activeSessionId);
      })
      .catch((err: unknown) => console.error('[ExecutionGraphView] session history load failed', err));

    return () => {
      cancelled = true;
    };
  }, [activeSessionId, messages, sessionMessages, setAgentTurns, setMessages]);

  useEffect(() => {
    const handleMouseMove = (event: globalThis.MouseEvent) => {
      const dragState = inspectorResizeRef.current;
      if (!dragState) {
        return;
      }

      const nextWidth = dragState.startWidth + (dragState.startX - event.clientX);
      setInspectorWidth(Math.max(280, Math.min(500, nextWidth)));
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
  const collapseTools = zoom <= 0.85;
  const decreaseZoom = () => setZoom((value) => clampZoom(value - 0.15));
  const increaseZoom = () => setZoom((value) => clampZoom(value + 0.15));
  const resetZoom = () => setZoom(DEFAULT_GRAPH_ZOOM);
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
  const activeArchitectureRunId = architectureRunIdFromRootSession(activeSessionId);
  const graphSurfaceClassName = 'flex-1 overflow-auto bg-[radial-gradient(circle_at_top,_rgba(56,189,248,0.08),_transparent_42%),linear-gradient(rgba(56,189,248,0.06)_1px,_transparent_1px),linear-gradient(90deg,_rgba(56,189,248,0.06)_1px,_transparent_1px)] bg-[length:100%_100%,32px_32px,32px_32px] bg-[#0a1220] p-4';
  const focusedGraph = focusExecutionGraphMessages(messages, focusMode);
  const hydrationStatus = extractExecutionGraphHydrationStatus(focusedGraph.messages, sessionMessages);
  const architectureRootModel = useMemo(() => {
    if (!activeSessionId || !architectureRootGraph) {
      return null;
    }

    return buildArchitectureRootGraphModel({
      graph: architectureRootGraph,
      rootSessionId: activeSessionId,
      sessions,
      sessionMessages,
    });
  }, [activeSessionId, architectureRootGraph, sessions, sessionMessages]);

  useEffect(() => {
    if (!activeSessionId || !activeArchitectureRunId) {
      setArchitectureRootGraph(null);
      return;
    }

    let cancelled = false;
    setArchitectureRootGraph(null);
    apiClient
      .get<ArchitectureGraphProjection>(`/api/architecture-runs/${activeArchitectureRunId}/graph`)
      .then((response) => {
        if (cancelled) {
          return;
        }
        setArchitectureRootGraph(response.data);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setArchitectureRootGraph(null);
          console.error('[ExecutionGraphView] architecture root graph load failed', err);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeArchitectureRunId, activeSessionId]);

  useEffect(() => {
    const branchSessionIds = extractArchitectureBranchSessionIds(focusedGraph.messages)
      .filter((sessionId) => (sessionMessages[sessionId]?.length ?? 0) === 0);
    if (branchSessionIds.length === 0) {
      return;
    }

    let cancelled = false;
    branchSessionIds.forEach((sessionId) => {
      apiClient
        .get<ChatMessage[]>(`/api/sessions/${sessionId}/messages`)
        .then((response) => {
          if (cancelled) {
            return;
          }
          setMessages(response.data, sessionId);
          setAgentTurns(buildTurnsFromHistory(response.data, sessionId), sessionId);
        })
        .catch((err: unknown) => console.error('[ExecutionGraphView] branch history load failed', err));
    });

    return () => {
      cancelled = true;
    };
  }, [focusedGraph.messages, sessionMessages, setAgentTurns, setMessages]);

  useEffect(() => {
    if (!activeSessionId || !activeArchitectureRunId) {
      return;
    }

    const branchSessionIds = sessions
      .filter((session) => session.kind === 'subagent' && session.parentSessionId === activeSessionId)
      .map((session) => session.id)
      .filter((sessionId) => (sessionMessages[sessionId]?.length ?? 0) === 0);
    if (branchSessionIds.length === 0) {
      return;
    }

    let cancelled = false;
    branchSessionIds.forEach((sessionId) => {
      apiClient
        .get<ChatMessage[]>(`/api/sessions/${sessionId}/messages`)
        .then((response) => {
          if (cancelled) {
            return;
          }
          setMessages(response.data, sessionId);
          setAgentTurns(buildTurnsFromHistory(response.data, sessionId), sessionId);
        })
        .catch((err: unknown) => console.error('[ExecutionGraphView] architecture branch history load failed', err));
    });

    return () => {
      cancelled = true;
    };
  }, [activeArchitectureRunId, activeSessionId, sessions, sessionMessages, setAgentTurns, setMessages]);

  const header = (
    <ExecutionGraphHeader
      cardDensity={cardDensity}
      collapseTools={collapseTools}
      focusMode={focusMode}
      hydrationStatus={hydrationStatus}
      onCardDensityChange={setCardDensity}
      onDecreaseZoom={decreaseZoom}
      onFocusModeChange={(mode) => {
        setFocusMode(mode);
        setSelectedNodeId(null);
      }}
      onIncreaseZoom={increaseZoom}
      onResetZoom={resetZoom}
      runningLoops={runningLoops}
      runningToolActivities={runningToolActivities}
      sessionTitleById={sessionTitleById}
      showFocusToggle={focusedGraph.architectureRunCount > 1}
      zoom={zoom}
    />
  );

  const liveActivitySidebar = (
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
              onClick={() => setActiveSession(session.id)}
            >
              <p className="text-xs font-medium text-base-content/90">{session.title}</p>
              <p className="mt-1 text-[10px] uppercase tracking-[0.14em] text-base-content/45">{session.kind === 'subagent' ? 'subagent session' : session.kind === 'cli-agent' ? 'cli agent session' : 'chat session'}</p>
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

  const visibleMessages = focusedGraph.messages;
  const visiblePromptIds = new Set(visibleMessages.filter((message) => message.role === 'user').map((message) => message.id));
  const graphTurns = agentTurns.length > 0
    ? agentTurns.filter((turn) => !turn.promptMessageId || visiblePromptIds.has(turn.promptMessageId))
    : buildTurnsFromHistory(visibleMessages, activeSessionId);
  const messageModel = buildExecutionGraphModel({
    sessionId: activeSessionId,
    messages: visibleMessages,
    turns: graphTurns,
    toolActivities,
    activeAgentLoops,
    sessions,
    sessionMessages,
    sessionAgentTurns,
    personas,
    collapseTools,
  });
  const model = messageModel.nodes.length === 0 && architectureRootModel ? architectureRootModel : messageModel;

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
    <div data-testid="execution-graph-view" className="flex h-full flex-col overflow-y-auto bg-base-100 xl:flex-row xl:overflow-hidden">
      <div className="flex-1 min-w-0 flex flex-col overflow-visible xl:overflow-hidden">
        {header}

        <ExecutionGraphBoard
          cardDensity={cardDensity}
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
        className="hidden w-2 shrink-0 cursor-col-resize bg-base-200/40 transition-colors hover:bg-sky-500/25 xl:block"
        onMouseDown={startInspectorResize}
      />

      <ExecutionGraphInspector
        selectedNode={selectedNode}
        activeSessionId={activeSessionId}
        inspectorWidth={inspectorWidth}
        selectedConfirmation={selectedConfirmation}
        setActiveSession={setActiveSession}
        onOpenSessionInConversation={onOpenSessionInConversation}
        setPendingConfirmation={setPendingConfirmation}
        setPendingMessage={setPendingMessage}
      />
    </div>
  );
}
