import { useEffect, useMemo, useRef } from 'react';
import {
  Loader2, ArrowLeftFromLine, ArrowRightToLine, Info,
} from 'lucide-react';
import { useAgentStore } from '../../store/agentStore';
import { useSessionStore } from '../../store/sessionStore';
import { eventBus } from '../../services/eventBus';
import type { ChatSession } from '@kalio/types';
import { findArchitectureRunInMessages } from './architectureChatSummary';
import { ArchitectureRunCanvasSection } from './CanvasPanel.ArchitectureRun';
import { CanvasFocusSection, hasVisibleBranchTranscript } from './CanvasPanel.Focus';
import { useHydrateChildSessionTranscripts } from './CanvasPanel.hydration';
import { findFocusedSubAgentFlowResult, SessionStats, ThinkingPreview, ToolCard } from './CanvasPanel.Parts';
import { AgentFlowConversationCard, buildAgentFlowPreviews } from './CanvasPanel.AgentFlows';
import { buildSubagentPreviews, SubagentConversationCard } from './CanvasPanel.Subagents';
import { buildCliChildPreviews, CliChildConversationCanvasCard } from './CanvasPanel.CliChildren';
import { SubAgentFlowResultBlock } from './ToolCallBubble.ResultBlocks';
import { AgentFlowResumeAction, isResumableAgentFlowStatus } from '../agent-flow/AgentFlowResumeAction';
import { filterRenderableSessions } from '../sessions/sessionRenderableFilter';
import { architectureRunIdForSession, sameArchitectureRunId } from '../sessions/sessionTreeDisplay';
import { resolveLiveTurnState } from './liveTurnState';
import { activateConversationSession } from './activeConversationSession';
import {
  mergeRuntimeQueuedDepthBySession,
  mergeRuntimeSessionStatusSnapshots,
  selectLiveSessionIds,
  selectQueuedDepth,
} from '../../store/agentRuntimeSelectors';

function isArchitectureTechnicalConversation(session: ChatSession): boolean {
  const architectureContext = session.runtimeContext?.architectureContext;
  if (!architectureContext || typeof architectureContext !== 'object' || Array.isArray(architectureContext)) {
    return false;
  }
  const context = architectureContext as Record<string, unknown>;
  if (context['sessionSurface'] === 'technical-node') {
    return true;
  }
  const roleSlotType = context['roleSlotType'];
  return roleSlotType === 'router' || roleSlotType === 'finalizer' || roleSlotType === 'orchestrator';
}

export function CanvasPanel() {
  const {
    canvasOpen,
    canvasFocus,
    setCanvasFocus,
    toggleCanvas,
    cliChildProjections,
    pendingConfirmations,
    pendingBudgetApprovals,
    queuedDepthBySession,
    sessionStatusSnapshots,
    runtimeActivitySnapshots,
    getRuntimeActivitySnapshot,
    getToolActivitiesForSession,
    hasActiveLoopForSession,
  } = useAgentStore();
  const {
    messages,
    activeSessionId,
    sessions,
    sessionMessages,
    setActiveSession,
    getSessionMessages,
    setMessages,
    agentTurns,
    getSessionActiveTurnId,
    streamingChunks,
    thinkingChunks,
    chunkSessionIds,
  } = useSessionStore();
  const open = canvasOpen;
  const knownSessionIds = useMemo(
    () => new Set(sessions.map((session) => session.id)),
    [sessions],
  );
  const activeRuntimeSnapshot = getRuntimeActivitySnapshot(activeSessionId);
  const activeSessionToolActivities = getToolActivitiesForSession(activeSessionId);
  const activeChildExecutions = activeRuntimeSnapshot?.childExecutions ?? [];
  const masterActivities = activeSessionToolActivities.filter((activity) => activity.agentRun?.agentType !== 'subagent');
  const subagentActivities = activeSessionToolActivities.filter((activity) => activity.agentRun?.agentType === 'subagent');
  const subagentPreviews = useMemo(
    () => buildSubagentPreviews(messages, activeSessionToolActivities, sessions, activeChildExecutions),
    [activeChildExecutions, activeSessionToolActivities, messages, sessions],
  );
  const agentFlowPreviews = useMemo(
    () => buildAgentFlowPreviews(messages, activeSessionToolActivities, sessions, activeChildExecutions),
    [activeChildExecutions, activeSessionToolActivities, messages, sessions],
  );
  const sessionTitleMap = useMemo(
    () => new Map(sessions.map((session) => [session.id, session.title])),
    [sessions],
  );
  const cliChildPreviews = useMemo(
    () => buildCliChildPreviews(activeSessionId, cliChildProjections, activeChildExecutions, sessionTitleMap),
    [activeChildExecutions, activeSessionId, cliChildProjections, sessionTitleMap],
  );
  const architectureRun = useMemo(
    () => findArchitectureRunInMessages(messages),
    [messages],
  );
  const architecturePreviewSessionIds = useMemo(() => {
    if (!architectureRun) {
      return new Set<string>();
    }

    return new Set(
      sessions
        .filter((session) => sameArchitectureRunId(architectureRunIdForSession(session), architectureRun.runId))
        .map((session) => session.id),
    );
  }, [architectureRun, sessions]);
  const architectureTechnicalConversationSessionIds = useMemo(() => {
    if (!architectureRun) {
      return new Set<string>();
    }

    return new Set(
      sessions
        .filter((session) => (
          sameArchitectureRunId(architectureRunIdForSession(session), architectureRun.runId)
          && isArchitectureTechnicalConversation(session)
        ))
        .map((session) => session.id),
    );
  }, [architectureRun, sessions]);
  const openableArchitectureConversationSessionIds = useMemo(() => {
    const effectiveQueuedDepthBySession = mergeRuntimeQueuedDepthBySession(
      queuedDepthBySession,
      runtimeActivitySnapshots,
    );
    const effectiveSessionStatusSnapshots = mergeRuntimeSessionStatusSnapshots(
      sessionStatusSnapshots,
      runtimeActivitySnapshots,
    );
    const liveSessionIds = selectLiveSessionIds({
      sessionStatusSnapshots,
      runtimeActivitySnapshots,
    });
    const { renderableSessions } = filterRenderableSessions(
      sessions,
      sessionMessages ?? {},
      {
        pendingConfirmations,
        pendingBudgetApprovals,
        activeLoopSessionIds: liveSessionIds,
        queuedDepthBySession: effectiveQueuedDepthBySession,
        sessionStatusSnapshots: effectiveSessionStatusSnapshots,
      },
    );
    return new Set([
      ...renderableSessions.map((session) => session.id),
      ...architectureTechnicalConversationSessionIds,
    ]);
  }, [
    architectureTechnicalConversationSessionIds,
    pendingBudgetApprovals,
    pendingConfirmations,
    queuedDepthBySession,
    runtimeActivitySnapshots,
    sessionMessages,
    sessionStatusSnapshots,
    sessions,
  ]);
  const visibleSubagentPreviews = useMemo(
    () => subagentPreviews.filter((preview) => !architecturePreviewSessionIds.has(preview.sessionId)),
    [architecturePreviewSessionIds, subagentPreviews],
  );
  const focusedSubAgentFlowResult = useMemo(
    () => findFocusedSubAgentFlowResult(
      messages,
      canvasFocus?.kind === 'architecture-run' ? canvasFocus.runId : undefined,
    ),
    [canvasFocus, messages],
  );
  const focusedCanvasSessionId = canvasFocus?.kind === 'architecture-branch' ? canvasFocus.sessionId : undefined;
  const childPreviewSessionIds = useMemo(
    () => Array.from(
      new Set(
        [
          ...visibleSubagentPreviews.map((preview) => preview.sessionId),
          ...cliChildPreviews.map((preview) => preview.childSessionId),
          ...agentFlowPreviews.map((preview) => preview.sessionId),
          ...(focusedCanvasSessionId ? [focusedCanvasSessionId] : []),
        ]
          .filter((sessionId) => sessionId !== activeSessionId && knownSessionIds.has(sessionId)),
      ),
    ).sort(),
    [activeSessionId, agentFlowPreviews, cliChildPreviews, focusedCanvasSessionId, knownSessionIds, visibleSubagentPreviews],
  );
  const childPreviewSessionKey = childPreviewSessionIds.join('|');
  const identifiedChildPreviewSessionIdsRef = useRef<Set<string>>(new Set());
  const previewToolCallIds = useMemo(
    () => new Set(
      activeSessionToolActivities
        .filter((activity) => (
          (activity.toolName === 'run_subagent' || activity.toolName === 'run_sub_agentflow')
          && activity.result?.status === 'success'
        ))
        .map((activity) => activity.callId),
    ),
    [activeSessionToolActivities],
  );
  const activeSessionLiveTurn = resolveLiveTurnState({
    sessionId: activeSessionId,
    sessionMessages: messages,
    agentTurns,
    activeTurnId: getSessionActiveTurnId(activeSessionId),
    isStreaming: false,
    streamingSessionId: null,
    awaitingFirstChunk: false,
    hasActiveLoop: hasActiveLoopForSession(activeSessionId),
    queuedDepth: selectQueuedDepth({
      sessionId: activeSessionId,
      queuedDepthBySession,
      runtimeActivitySnapshots,
    }),
    activeToolActivities: getToolActivitiesForSession(activeSessionId),
    streamingChunks,
    thinkingChunks,
    chunkSessionIds,
  });
  const hasActiveSessionLiveTurn = activeSessionLiveTurn.phase !== 'idle';
  // Show toggle only when agent has activity or canvas is already open
  const visibleMasterActivities = masterActivities.filter((activity) => (
    (activity.toolName !== 'run_subagent' && activity.toolName !== 'run_sub_agentflow')
    || !previewToolCallIds.has(activity.callId)
  ));
  const showToggle = hasActiveSessionLiveTurn
    || visibleMasterActivities.length > 0
    || subagentActivities.length > 0
    || visibleSubagentPreviews.length > 0
    || cliChildPreviews.length > 0
    || agentFlowPreviews.length > 0
    || open;

  useEffect(() => {
    if (!eventBus.connected) return;
    const previousChildPreviewSessionIds = identifiedChildPreviewSessionIdsRef.current;
    childPreviewSessionIds.forEach((sessionId) => {
      if (sessionId !== activeSessionId && !previousChildPreviewSessionIds.has(sessionId)) {
        eventBus.identifySession(sessionId);
      }
    });
    identifiedChildPreviewSessionIdsRef.current = new Set(childPreviewSessionIds);
  }, [activeSessionId, childPreviewSessionIds, childPreviewSessionKey]);

  useEffect(() => {
    if (canvasFocus?.kind !== 'architecture-branch') {
      return;
    }
    if (knownSessionIds.has(canvasFocus.sessionId)) {
      return;
    }
    setCanvasFocus(null);
  }, [canvasFocus, knownSessionIds, setCanvasFocus]);

  const focusedTranscriptOverride = useHydrateChildSessionTranscripts({
    activeSessionId,
    childPreviewSessionIds,
    focusedCanvasSessionId,
    getSessionMessages,
    sessionMessages,
    setMessages,
  });
  const focusedCanvasTranscript = canvasFocus?.kind === 'architecture-branch'
    ? getSessionMessages(canvasFocus.sessionId)
    : [];
  const focusedTranscriptOverrideMatches = focusedTranscriptOverride?.some((message) => message.sessionId === focusedCanvasSessionId) ?? false;
  const focusedCanvasDisplayTranscript = hasVisibleBranchTranscript(focusedCanvasTranscript)
    ? focusedCanvasTranscript
    : focusedTranscriptOverrideMatches && focusedTranscriptOverride ? focusedTranscriptOverride : focusedCanvasTranscript;

  return (
    <>
      {/* Toggle tab — only visible when agent is active or canvas is open */}
      {showToggle && (
        <button
          className="absolute right-0 top-1/2 z-20 flex h-14 w-6 -translate-y-1/2 items-center justify-center rounded-l-md border border-base-300 bg-base-200 transition-colors hover:bg-base-300"
          onClick={toggleCanvas}
          aria-label={open ? 'Close canvas' : 'Open canvas'}
          data-testid="canvas-toggle"
        >
          {open ? <ArrowRightToLine size={12} /> : <ArrowLeftFromLine size={12} />}
        </button>
      )}

      {open && (
        <aside
          data-testid="canvas-panel"
          className="shrink-0 border-l border-base-300 bg-base-100 flex w-[20.5rem] flex-col overflow-hidden xl:w-[21rem]"
        >
          <div className="flex h-full w-full flex-col overflow-hidden">
            <div className="flex shrink-0 items-center gap-2 border-b border-base-300 bg-base-200 px-4 py-2">
              <Info size={14} className="text-base-content/50" />
              <span className="flex-1 text-sm font-semibold">Canvas</span>
              {hasActiveSessionLiveTurn && <Loader2 size={12} className="animate-spin text-info" />}
            </div>

            <div className="flex-1 space-y-4 overflow-y-auto p-3">
              {hasActiveSessionLiveTurn && (
                <section>
                  <p className="mb-2 text-[10px] uppercase tracking-wide text-base-content/40">Live</p>
                  <ThinkingPreview />
                </section>
              )}

              {canvasFocus?.kind === 'architecture-branch' && (
                <CanvasFocusSection
                  focus={canvasFocus}
                  sessions={sessions}
                  transcript={focusedCanvasDisplayTranscript}
                  onClear={() => setCanvasFocus(null)}
                  onOpenSession={(sessionId) => {
                    void activateConversationSession({
                      sessionId,
                      sessions,
                      setActiveSession,
                      reason: 'canvas',
                    });
                  }}
                />
              )}

              {architectureRun && (
                <ArchitectureRunCanvasSection
                  run={architectureRun}
                  sessions={sessions}
                  knownBranchSessionIds={openableArchitectureConversationSessionIds}
                  onOpenSession={(sessionId) => setCanvasFocus({ kind: 'architecture-branch', sessionId })}
                  getBranchMessages={(sessionId) => getSessionMessages(sessionId)}
                  focused={canvasFocus?.kind === 'architecture-run' && canvasFocus.runId === architectureRun.runId}
                  focusedStep={canvasFocus?.kind === 'architecture-run' && canvasFocus.runId === architectureRun.runId
                    ? { eventId: canvasFocus.eventId, nodeId: canvasFocus.nodeId }
                    : undefined}
                />
              )}

              {focusedSubAgentFlowResult && (
                <section data-testid="agentflow-canvas-section">
                  <p className="mb-2 text-[10px] uppercase tracking-wide text-base-content/40">AgentFlow</p>
                  <SubAgentFlowResultBlock result={focusedSubAgentFlowResult} />
                  {isResumableAgentFlowStatus(focusedSubAgentFlowResult.status) && (
                    <AgentFlowResumeAction flowRunId={focusedSubAgentFlowResult.flowRunId} />
                  )}
                </section>
              )}

              {agentFlowPreviews.length > 0 && (
                <section data-testid="canvas-agentflows-section">
                  <p className="mb-2 text-[10px] uppercase tracking-wide text-base-content/40">AgentFlows</p>
                  <div className="space-y-1.5">
                    {agentFlowPreviews.map((preview) => (
                      <AgentFlowConversationCard
                        key={preview.flowRunId}
                        preview={preview}
                        onOpenChat={() => {
                          void activateConversationSession({
                            sessionId: preview.sessionId,
                            sessions,
                            setActiveSession,
                            reason: 'canvas',
                          });
                        }}
                        onOpenGraph={() => setCanvasFocus({ kind: 'architecture-run', runId: preview.graphRunId })}
                      />
                    ))}
                  </div>
                </section>
              )}

              {cliChildPreviews.length > 0 && (
                <section data-testid="canvas-cli-children-section">
                  <p className="mb-2 text-[10px] uppercase tracking-wide text-base-content/40">CLI children</p>
                  <div className="space-y-1.5">
                    {cliChildPreviews.map((preview) => (
                      <CliChildConversationCanvasCard
                        key={preview.childSessionId}
                        preview={preview}
                        onOpen={() => {
                          void activateConversationSession({
                            sessionId: preview.childSessionId,
                            sessions,
                            setActiveSession,
                            reason: 'canvas',
                          });
                        }}
                      />
                    ))}
                  </div>
                </section>
              )}

              {visibleSubagentPreviews.length > 0 && (
                <section data-testid="canvas-subagents-section">
                  <p className="mb-2 text-[10px] uppercase tracking-wide text-base-content/40">Sub-agents</p>
                  <div className="space-y-1.5">
                    {visibleSubagentPreviews.map((preview) => (
                      <SubagentConversationCard
                        key={preview.sessionId}
                        preview={preview}
                        transcript={getSessionMessages(preview.sessionId)}
                        onOpen={() => {
                          void activateConversationSession({
                            sessionId: preview.sessionId,
                            sessions,
                            setActiveSession,
                            reason: 'canvas',
                          });
                        }}
                      />
                    ))}
                  </div>
                </section>
              )}

              {subagentActivities.length > 0 && (
                <section>
                  <p className="mb-2 text-[10px] uppercase tracking-wide text-base-content/40">
                    Sub-agent tools ({subagentActivities.length})
                  </p>
                  <div className="space-y-1.5">
                    {subagentActivities.map((a) => (
                      <ToolCard key={a.callId} activity={a} />
                    ))}
                  </div>
                </section>
              )}

              {visibleMasterActivities.length > 0 && (
                <section>
                  <p className="mb-2 text-[10px] uppercase tracking-wide text-base-content/40">
                    Tools ({visibleMasterActivities.length})
                  </p>
                  <div className="space-y-1.5">
                    {visibleMasterActivities.map((a) => (
                      <ToolCard key={a.callId} activity={a} />
                    ))}
                  </div>
                </section>
              )}

              <section>
                <p className="mb-2 text-[10px] uppercase tracking-wide text-base-content/40">Session</p>
                <SessionStats />
              </section>
            </div>
          </div>
        </aside>
      )}
    </>
  );
}
