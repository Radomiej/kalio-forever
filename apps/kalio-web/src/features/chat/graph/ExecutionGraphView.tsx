import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { nanoid } from 'nanoid';
import type { ArchitectureGraphProjection, ChatMessage, ChatSession, Persona } from '@kalio/types';
import { useAgentStore } from '../../../store/agentStore';
import { useSessionStore } from '../../../store/sessionStore';
import { apiClient } from '../../../services/apiClient';
import { eventBus } from '../../../services/eventBus';
import { buildTurnsFromHistory } from '../chatUtils';
import {
  buildExecutionGraphModel,
} from './executionGraphModel';
import { ExecutionGraphBoard } from './ExecutionGraphBoard';
import type { GraphCardDensity } from './ExecutionGraphBoard.types';
import { ExecutionGraphHeader } from './ExecutionGraphHeader';
import { ExecutionGraphInspector } from './ExecutionGraphInspector';
import { ExecutionGraphLiveSidebar, isLiveTool } from './ExecutionGraphLiveSidebar';
import { ExecutionGraphNoNodesState, ExecutionGraphNoSessionState } from './ExecutionGraphEmptyStates';
import { focusExecutionGraphMessages, type ExecutionGraphFocusMode } from './executionGraphFocus';
import { extractArchitectureBranchSessionIds, extractExecutionGraphHydrationStatus } from './executionGraphHydration';
import { architectureRunIdFromRootSession, buildArchitectureRootGraphModel } from './executionGraphArchitectureRoot';

const DEFAULT_GRAPH_ZOOM = 0.82;
const MIN_GRAPH_ZOOM = 0.58;
const MAX_GRAPH_ZOOM = 1.6;
const GRAPH_ZOOM_STEP = 0.15;
const DEFAULT_INSPECTOR_WIDTH = 280;

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
    addSession,
    addMessage,
    setActiveSession,
    setMessages,
    setAgentTurns,
    setPendingMessage,
    updateSession,
  } = useSessionStore();
  const {
    toolActivities,
    activeAgentLoops,
    pendingConfirmations,
    isStreaming,
    clearToolActivities,
    setPendingConfirmation,
    setStreaming,
  } = useAgentStore();
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [zoom, setZoom] = useState(DEFAULT_GRAPH_ZOOM);
  const [inspectorWidth, setInspectorWidth] = useState(DEFAULT_INSPECTOR_WIDTH);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [focusMode, setFocusMode] = useState<ExecutionGraphFocusMode>('latest-architecture');
  const [cardDensity, setCardDensity] = useState<GraphCardDensity>('compact');
  const [resetViewportToken, setResetViewportToken] = useState(0);
  const [architectureRootGraph, setArchitectureRootGraph] = useState<ArchitectureGraphProjection | null>(null);
  const [emptyPromptError, setEmptyPromptError] = useState<string | null>(null);
  const [creatingGraphSession, setCreatingGraphSession] = useState(false);
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

  const clampZoom = (value: number) => Math.max(MIN_GRAPH_ZOOM, Math.min(MAX_GRAPH_ZOOM, Number(value.toFixed(2))));
  const collapseTools = zoom <= 0.85;
  const decreaseZoom = () => setZoom((value) => clampZoom(value - GRAPH_ZOOM_STEP));
  const increaseZoom = () => setZoom((value) => clampZoom(value + GRAPH_ZOOM_STEP));
  const resetZoom = () => {
    setZoom(DEFAULT_GRAPH_ZOOM);
    setResetViewportToken((value) => value + 1);
  };
  const fitAll = () => {
    setZoom(DEFAULT_GRAPH_ZOOM);
    setResetViewportToken((value) => value + 1);
  };
  const handleWheelZoom = (deltaY: number) => {
    if (deltaY === 0) {
      return zoom;
    }

    const nextZoom = clampZoom(zoom + (deltaY < 0 ? GRAPH_ZOOM_STEP : -GRAPH_ZOOM_STEP));
    setZoom(nextZoom);
    return nextZoom;
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
      onFitAll={fitAll}
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
    <ExecutionGraphLiveSidebar
      defaultCollapsed={runningLoops.length === 0 && runningToolActivities.length === 0}
      runningLoops={runningLoops}
      runningToolActivities={runningToolActivities}
      sessions={sessions}
      sessionTitleById={sessionTitleById}
      onSelectSession={setActiveSession}
    />
  );

  const sendGraphPromptToSession = (session: ChatSession, content: string, isFirstMessage: boolean) => {
    if (isStreaming) {
      return;
    }
    if (!eventBus.connected) {
      setEmptyPromptError('Backend connection is offline. Reconnect and retry this message.');
      return;
    }

    setEmptyPromptError(null);
    clearToolActivities(session.id);
    if ((session.title === 'New Chat' || session.title === '') && isFirstMessage) {
      const preview = content.slice(0, 50).trim();
      updateSession(session.id, { title: preview + (content.length > 50 ? '...' : '') });
    }

    addMessage({
      id: nanoid(),
      sessionId: session.id,
      role: 'user',
      content,
      createdAt: Date.now(),
    });
    setStreaming(true);

    const sent = eventBus.sendMessage({
      sessionId: session.id,
      content,
      personaId: session.personaId,
    });

    if (!sent) {
      setStreaming(false);
      setEmptyPromptError('Backend connection is offline. Reconnect and retry this message.');
    }
  };

  const sendEmptyGraphPrompt = (content: string) => {
    if (!activeSessionId || !activeSession) {
      return;
    }
    sendGraphPromptToSession(activeSession, content, messages.length === 0);
  };

  const createAndSendGraphPrompt = async (content: string) => {
    if (isStreaming || creatingGraphSession) {
      return;
    }
    if (!eventBus.connected) {
      setEmptyPromptError('Backend connection is offline. Reconnect and retry this message.');
      return;
    }

    setCreatingGraphSession(true);
    setEmptyPromptError(null);
    try {
      const response = await apiClient.post<ChatSession>('/api/sessions', {
        personaId: 'default',
        title: 'New Chat',
      });
      addSession(response.data);
      setActiveSession(response.data.id);
      setMessages([], response.data.id);
      sendGraphPromptToSession(response.data, content, true);
    } catch (err) {
      setEmptyPromptError(err instanceof Error ? err.message : 'Failed to create a graph chat.');
    } finally {
      setCreatingGraphSession(false);
    }
  };

  if (!activeSessionId) {
    return (
      <div data-testid="execution-graph-view" className="flex h-full overflow-hidden bg-base-100">
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
          {header}
          <ExecutionGraphNoSessionState
            disabled={isStreaming || creatingGraphSession}
            error={emptyPromptError}
            graphSurfaceClassName={graphSurfaceClassName}
            liveActivitySidebar={liveActivitySidebar}
            onSendPrompt={(content) => void createAndSendGraphPrompt(content)}
            selectableSessions={selectableSessions}
            onSelectSession={setActiveSession}
          />
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
    : null;
  const selectedNode = model.nodes.find((node) => node.id === effectiveSelectedId) ?? null;
  const selectedConfirmation = selectedNode?.payload.kind === 'tool' && selectedNode.payload.confirmationRequired
    ? pendingConfirmations[selectedNode.sessionId ?? activeSessionId ?? ''] ?? null
    : null;

  if (model.nodes.length === 0) {
    return (
      <div data-testid="execution-graph-view" className="flex h-full overflow-hidden bg-base-100">
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
          {header}
          <ExecutionGraphNoNodesState
            activeSession={activeSession}
            disabled={isStreaming}
            error={emptyPromptError}
            graphSurfaceClassName={graphSurfaceClassName}
            liveActivitySidebar={liveActivitySidebar}
            onSendPrompt={sendEmptyGraphPrompt}
          />
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
          resetViewportToken={resetViewportToken}
          selectedNodeId={effectiveSelectedId}
          onSelectNode={setSelectedNodeId}
          zoom={zoom}
          onFitZoom={setZoom}
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
