import { useState, useEffect, useMemo, useRef } from 'react';
import {
  Loader2, ArrowLeftFromLine, ArrowRightToLine, Info,
} from 'lucide-react';
import { useAgentStore } from '../../store/agentStore';
import { useSessionStore } from '../../store/sessionStore';
import { apiClient } from '../../services/apiClient';
import { eventBus } from '../../services/eventBus';
import type { ChatMessage } from '@kalio/types';
import { findArchitectureRunInMessages } from './architectureChatSummary';
import { mergeFetchedMessages } from './chatUtils';
import { ArchitectureRunCanvasSection } from './CanvasPanel.ArchitectureRun';
import { CanvasFocusSection } from './CanvasPanel.Focus';
import { findFocusedSubAgentFlowResult, SessionStats, ThinkingPreview, ToolCard } from './CanvasPanel.Parts';
import { AgentFlowConversationCard, buildAgentFlowPreviews } from './CanvasPanel.AgentFlows';
import { buildSubagentPreviews, SubagentConversationCard } from './CanvasPanel.Subagents';
import { SubAgentFlowResultBlock } from './ToolCallBubble.ResultBlocks';

export function CanvasPanel() {
  const { toolActivities, isStreaming, canvasOpen, canvasFocus, setCanvasFocus, toggleCanvas, activeAgentLoops } = useAgentStore();
  const { messages, activeSessionId, sessions, sessionMessages, setActiveSession, getSessionMessages, setMessages } = useSessionStore();
  const [hydratedSubagentSessions, setHydratedSubagentSessions] = useState<Record<string, true>>({});
  const open = canvasOpen;
  const subagentLoops = Object.values(activeAgentLoops).filter((loop) => loop.agentRun?.agentType === 'subagent');
  const masterActivities = toolActivities.filter((activity) => activity.agentRun?.agentType !== 'subagent');
  const subagentActivities = toolActivities.filter((activity) => activity.agentRun?.agentType === 'subagent');
  const subagentPreviews = useMemo(
    () => buildSubagentPreviews(messages, toolActivities, activeAgentLoops, sessions),
    [activeAgentLoops, messages, sessions, toolActivities],
  );
  const agentFlowPreviews = useMemo(
    () => buildAgentFlowPreviews(messages, toolActivities, sessions),
    [messages, sessions, toolActivities],
  );
  const architectureRun = useMemo(
    () => findArchitectureRunInMessages(messages),
    [messages],
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
          ...subagentPreviews.map((preview) => preview.sessionId),
          ...agentFlowPreviews.map((preview) => preview.sessionId),
          ...(focusedCanvasSessionId ? [focusedCanvasSessionId] : []),
        ]
          .filter((sessionId) => sessionId !== activeSessionId),
      ),
    ).sort(),
    [activeSessionId, agentFlowPreviews, focusedCanvasSessionId, subagentPreviews],
  );
  const childPreviewSessionKey = childPreviewSessionIds.join('|');
  const identifiedChildPreviewSessionIdsRef = useRef<Set<string>>(new Set());
  const previewToolCallIds = useMemo(
    () => new Set(
      toolActivities
        .filter((activity) => (
          (activity.toolName === 'run_subagent' || activity.toolName === 'run_sub_agentflow')
          && activity.result?.status === 'success'
        ))
        .map((activity) => activity.callId),
    ),
    [toolActivities],
  );
  // Show toggle only when agent has activity or canvas is already open
  const visibleMasterActivities = masterActivities.filter((activity) => (
    (activity.toolName !== 'run_subagent' && activity.toolName !== 'run_sub_agentflow')
    || !previewToolCallIds.has(activity.callId)
  ));
  const showToggle = isStreaming
    || visibleMasterActivities.length > 0
    || subagentActivities.length > 0
    || subagentLoops.length > 0
    || subagentPreviews.length > 0
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
    let cancelled = false;
    const missingSessionIds = childPreviewSessionIds
      .filter((sessionId) => !hydratedSubagentSessions[sessionId] && sessionId !== activeSessionId && (sessionMessages[sessionId]?.length ?? 0) === 0);

    if (missingSessionIds.length === 0) return;

    void Promise.all(
      missingSessionIds.map(async (sessionId) => {
        const response = await apiClient.get<ChatMessage[]>(`/api/sessions/${sessionId}/messages`);
        return [sessionId, response.data] as const;
      }),
    )
      .then((results) => {
        if (cancelled) return;
        results.forEach(([sessionId, loadedMessages]) => {
          const currentMessages = getSessionMessages(sessionId);
          setMessages(mergeFetchedMessages(currentMessages, loadedMessages), sessionId);
        });
        setHydratedSubagentSessions((current) => {
          const next = { ...current };
          results.forEach(([sessionId]) => {
            next[sessionId] = true;
          });
          return next;
        });
      })
      .catch((err: unknown) => {
        console.error('[CanvasPanel] failed to load subagent transcript', err instanceof Error ? err : new Error(String(err)));
      });

    return () => {
      cancelled = true;
    };
  }, [activeSessionId, childPreviewSessionIds, getSessionMessages, hydratedSubagentSessions, sessionMessages, setMessages]);

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
              {isStreaming && <Loader2 size={12} className="animate-spin text-info" />}
            </div>

            <div className="flex-1 space-y-4 overflow-y-auto p-3">
              {isStreaming && (
                <section>
                  <p className="mb-2 text-[10px] uppercase tracking-wide text-base-content/40">Live</p>
                  <ThinkingPreview />
                </section>
              )}

              {canvasFocus?.kind === 'architecture-branch' && (
                <CanvasFocusSection
                  focus={canvasFocus}
                  sessions={sessions}
                  transcript={getSessionMessages(canvasFocus.sessionId)}
                  onClear={() => setCanvasFocus(null)}
                  onOpenSession={(sessionId) => setActiveSession(sessionId)}
                />
              )}

              {architectureRun && (
                <ArchitectureRunCanvasSection
                  run={architectureRun}
                  sessions={sessions}
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
                        onOpenChat={() => setActiveSession(preview.sessionId)}
                        onOpenGraph={() => setCanvasFocus({ kind: 'architecture-run', runId: preview.graphRunId })}
                      />
                    ))}
                  </div>
                </section>
              )}

              {subagentPreviews.length > 0 && (
                <section data-testid="canvas-subagents-section">
                  <p className="mb-2 text-[10px] uppercase tracking-wide text-base-content/40">Sub-agents</p>
                  <div className="space-y-1.5">
                    {subagentPreviews.map((preview) => (
                      <SubagentConversationCard
                        key={preview.sessionId}
                        preview={preview}
                        transcript={getSessionMessages(preview.sessionId)}
                        onOpen={() => setActiveSession(preview.sessionId)}
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
