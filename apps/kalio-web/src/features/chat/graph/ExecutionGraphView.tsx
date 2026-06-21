import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import type { ArchitectureGraphProjection } from '@kalio/types';
import { useAgentStore } from '../../../store/agentStore';
import { useSessionStore } from '../../../store/sessionStore';
import { apiClient } from '../../../services/apiClient';
import { buildTurnsFromHistory } from '../chatUtils';
import { hydrateActiveConversationSession } from '../activeConversationSession';
import {
  buildExecutionGraphModel,
} from './executionGraphModel';
import { ExecutionGraphBoard } from './ExecutionGraphBoard';
import type { GraphCardDensity } from './ExecutionGraphBoard.types';
import { ExecutionGraphHeader } from './ExecutionGraphHeader';
import { ExecutionGraphInspector } from './ExecutionGraphInspector';
import { isLiveTool } from './ExecutionGraphLiveSidebar';
import { ExecutionGraphNoNodesState, ExecutionGraphNoSessionState } from './ExecutionGraphEmptyStates';
import { focusExecutionGraphMessages, type ExecutionGraphFocusMode } from './executionGraphFocus';
import { extractArchitectureBranchSessionIds, extractExecutionGraphHydrationStatus } from './executionGraphHydration';
import { architectureRunIdFromRootSession, buildArchitectureRootGraphModel } from './executionGraphArchitectureRoot';
import { useExecutionGraphLaunch } from './useExecutionGraphLaunch';
import {
  selectPendingConfirmationsForSession,
  selectRunningLoops,
} from '../../../store/agentRuntimeSelectors';

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
    getSessionMessages,
    getSessionAgentTurns,
    getSessionActiveTurnId,
    setActiveSession,
    setMessages,
    setAgentTurns,
    setPendingMessage,
  } = useSessionStore();
  const {
    toolActivities,
    pendingConfirmations,
    removePendingConfirmation,
    runtimeActivitySnapshots,
  } = useAgentStore();
  const {
    activeSession,
    architectures,
    emptyPromptError,
    isBusy,
    personas,
    projectPath,
    selectedPersonaId,
    selectedArchitectureId,
    setProjectPath,
    setSelectedPersonaId,
    setSelectedArchitectureId,
    sendEmptyGraphPrompt,
  } = useExecutionGraphLaunch();
  const [zoom, setZoom] = useState(DEFAULT_GRAPH_ZOOM);
  const [inspectorWidth, setInspectorWidth] = useState(DEFAULT_INSPECTOR_WIDTH);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [focusMode, setFocusMode] = useState<ExecutionGraphFocusMode>('latest-architecture');
  const [cardDensity, setCardDensity] = useState<GraphCardDensity>('compact');
  const [resetViewportToken, setResetViewportToken] = useState(0);
  const [architectureRootGraph, setArchitectureRootGraph] = useState<ArchitectureGraphProjection | null>(null);
  const inspectorResizeRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const hydrationInFlightRef = useRef<Set<string>>(new Set());

  const requestSessionHydration = (
    sessionId: string,
    getActiveSessionId: () => string | null,
    onError: (err: unknown) => void,
  ) => {
    if (hydrationInFlightRef.current.has(sessionId)) {
      return;
    }

    hydrationInFlightRef.current.add(sessionId);
    void hydrateActiveConversationSession({
      mode: 'reload',
      sessionId,
      getActiveSessionId,
      getSessions: () => sessions,
      getSessionMessages,
      setMessages,
      setAgentTurns,
      getSessionAgentTurns,
      getSessionActiveTurnId,
      hasActiveLoopForSession,
    })
      .catch(onError)
      .finally(() => {
        hydrationInFlightRef.current.delete(sessionId);
      });
  };

  useEffect(() => {
    if (!activeSessionId) {
      return;
    }

    const hydratedMessages = sessionMessages[activeSessionId] ?? messages;
    if (hydratedMessages.length > 0) {
      return;
    }

    let cancelled = false;
    requestSessionHydration(
      activeSessionId,
      () => activeSessionId,
      (err: unknown) => {
        if (!cancelled) {
          console.error('[ExecutionGraphView] session history load failed', err);
        }
      },
    );

    return () => {
      cancelled = true;
    };
  }, [
    activeSessionId,
    getSessionActiveTurnId,
    getSessionAgentTurns,
    getSessionMessages,
    messages,
    sessionMessages,
    sessions,
    setAgentTurns,
    setMessages,
  ]);

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

  const runningLoops = useMemo(
    () => selectRunningLoops({ runtimeActivitySnapshots }),
    [runtimeActivitySnapshots],
  );
  const activeRuntimeSnapshot = activeSessionId ? runtimeActivitySnapshots[activeSessionId] ?? null : null;
  const runtimeAwareAgentLoops = useMemo(
    () => Object.fromEntries(
      runningLoops.map((loop) => [`${loop.sessionId}:${loop.turnId}`, loop]),
    ),
    [runningLoops],
  );
  const hasActiveLoopForSession = (sessionId: string) => runningLoops.some((loop) => loop.sessionId === sessionId);
  const runningToolActivities = toolActivities.filter((activity) => isLiveTool(activity));
  const sessionTitleById = new Map(sessions.map((session) => [session.id, session.title]));
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
    const knownSessionIds = new Set(sessions.map((session) => session.id));
    const branchSessionIds = extractArchitectureBranchSessionIds(focusedGraph.messages)
      .filter((sessionId) => knownSessionIds.has(sessionId))
      .filter((sessionId) => (sessionMessages[sessionId]?.length ?? 0) === 0);
    if (branchSessionIds.length === 0) {
      return;
    }

    let cancelled = false;
    branchSessionIds.forEach((sessionId) => {
      requestSessionHydration(
        sessionId,
        () => useSessionStore.getState().activeSessionId,
        (err: unknown) => {
          if (!cancelled) {
            console.error('[ExecutionGraphView] branch history load failed', err);
          }
        },
      );
    });

    return () => {
      cancelled = true;
    };
  }, [
    focusedGraph.messages,
    getSessionActiveTurnId,
    getSessionAgentTurns,
    getSessionMessages,
    sessionMessages,
    sessions,
    setAgentTurns,
    setMessages,
  ]);

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
      requestSessionHydration(
        sessionId,
        () => useSessionStore.getState().activeSessionId,
        (err: unknown) => {
          if (!cancelled) {
            console.error('[ExecutionGraphView] architecture branch history load failed', err);
          }
        },
      );
    });

    return () => {
      cancelled = true;
    };
  }, [
    activeArchitectureRunId,
    activeSessionId,
    getSessionActiveTurnId,
    getSessionAgentTurns,
    getSessionMessages,
    sessionMessages,
    sessions,
    setAgentTurns,
    setMessages,
  ]);

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

  if (!activeSessionId) {
    return (
      <div data-testid="execution-graph-view" className="flex h-full overflow-hidden bg-base-100">
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
          {header}
          <ExecutionGraphNoSessionState
            architectures={architectures}
            graphSurfaceClassName={graphSurfaceClassName}
            error={emptyPromptError}
            heading="New Chat"
            isBusy={isBusy}
            onArchitectureChange={setSelectedArchitectureId}
            onDraftChange={() => undefined}
            onPersonaChange={setSelectedPersonaId}
            onProjectPathChange={setProjectPath}
            onRunPrompt={sendEmptyGraphPrompt}
            personas={personas}
            projectPath={projectPath}
            screenKey="graph-empty-root"
            selectedPersonaId={selectedPersonaId}
            selectedArchitectureId={selectedArchitectureId}
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
    activeAgentLoops: runtimeAwareAgentLoops,
    childExecutions: activeRuntimeSnapshot?.childExecutions ?? [],
    sessions,
    sessionMessages,
    sessionAgentTurns,
    personas,
    collapseTools,
  });
  const model = architectureRootModel && messageModel.nodes.every((node) => node.kind === 'prompt')
    ? architectureRootModel
    : messageModel;

  const effectiveSelectedId = model.nodes.some((node) => node.id === selectedNodeId)
    ? selectedNodeId
    : null;
  const selectedNode = model.nodes.find((node) => node.id === effectiveSelectedId) ?? null;
  const selectedNodeRequiresConfirmation = selectedNode?.payload.kind === 'tool'
    ? selectedNode.payload.confirmationRequired
    : selectedNode?.payload.kind === 'tool-group'
      ? selectedNode.payload.tools.some((tool) => tool.confirmationRequired)
      : false;
  const selectedSessionConfirmations = selectPendingConfirmationsForSession({
    sessionId: selectedNode?.sessionId ?? activeSessionId ?? null,
    pendingConfirmations,
  });
  const selectedConfirmation = selectedNodeRequiresConfirmation
    ? (() => {
        if (selectedNode?.payload.kind === 'tool') {
          const callId = selectedNode.payload.activity?.callId;
          return callId
            ? selectedSessionConfirmations.find((confirmation) => confirmation.toolCallId === callId) ?? null
            : null;
        }
        if (selectedNode?.payload.kind === 'tool-group') {
          const confirmationCallIds = new Set(
            selectedNode.payload.tools
              .filter((tool) => tool.confirmationRequired)
              .map((tool) => tool.callId),
          );
          return selectedSessionConfirmations.find((confirmation) => confirmationCallIds.has(confirmation.toolCallId)) ?? null;
        }
        return selectedSessionConfirmations[0] ?? null;
      })()
    : null;

  if (model.nodes.length === 0) {
    return (
      <div data-testid="execution-graph-view" className="flex h-full overflow-hidden bg-base-100">
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
          {header}
          <ExecutionGraphNoNodesState
            architectures={architectures}
            graphSurfaceClassName={graphSurfaceClassName}
            error={emptyPromptError}
            heading={activeSession?.title ?? 'New Chat'}
            isBusy={isBusy}
            onArchitectureChange={setSelectedArchitectureId}
            onDraftChange={() => undefined}
            onPersonaChange={setSelectedPersonaId}
            onProjectPathChange={setProjectPath}
            onRunPrompt={sendEmptyGraphPrompt}
            personas={personas}
            projectPath={projectPath}
            screenKey={activeSession?.id ?? 'graph-empty-session'}
            selectedPersonaId={selectedPersonaId}
            selectedArchitectureId={selectedArchitectureId}
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
        removePendingConfirmation={removePendingConfirmation}
        setPendingMessage={setPendingMessage}
      />
    </div>
  );
}
