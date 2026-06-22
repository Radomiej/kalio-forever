import { useEffect, useMemo, useRef, useState } from 'react';
import { BrainCircuit, ChevronDown } from 'lucide-react';
import { useSessionStore } from '../../store/sessionStore';
import { useAgentStore } from '../../store/agentStore';
import { MarkdownViewer } from '../../components/markdown/MarkdownViewer';
import type { AgentTurn } from '../../store/sessionStore';
import type { ToolActivity } from '../../store/agentStore';
import { ArchitectureRunTimeline } from './ArchitectureRunTimeline';
import { LiveToolCallBubble, HistoryToolCallBubble } from './ToolCallBubble';
import { extractCLIAgentResult, extractCLIAgentSessionSnapshot, extractPersistedToolResultMeta } from './ToolCallBubble.parsers';
import {
  isCliChildToolName,
  resolveCLIChildProjectionStatus,
  selectCLIChildProjectionFromSources,
  shouldRenderLiveCliChildStatus,
} from './cliChildProjection.model';
import { deriveVisibleTurnItems } from './agentTurnVisibleItems';
import { isMessageLiveStreaming } from './agentTurnStreaming';
import { eventBus } from '../../services/eventBus';
import { filterRenderableSessions } from '../sessions/sessionRenderableFilter';
import { architectureRunIdForSession, sameArchitectureRunId } from '../sessions/sessionTreeDisplay';
import { resolveWorkflowTurnProjection } from './workflowTurnProjection';
import type { ChatMessage } from '@kalio/types';
import {
  mergeRuntimeQueuedDepthBySession,
  mergeRuntimeSessionStatusSnapshots,
  selectLiveSessionIds,
} from '../../store/agentRuntimeSelectors';

interface Props {
  turn: AgentTurn;
  toolActivities: ToolActivity[];
  answeredCallIds?: Set<string>;
  renderedMessages?: ChatMessage[];
}

// ─── ThinkingBlock ────────────────────────────────────────────────────────────

function ThinkingBlock({ content, isStreaming }: { content: string; isStreaming: boolean }) {
  const [open, setOpen] = useState(false);
  const didAutoOpen = useRef(false);

  useEffect(() => {
    if (isStreaming && content.length > 0 && !didAutoOpen.current) {
      didAutoOpen.current = true;
      setOpen(true);
    }
    if (!isStreaming) didAutoOpen.current = false;
  }, [isStreaming, content.length]);

  return (
    <div className="border border-base-content/10 rounded-lg overflow-hidden">
      <button
        className="flex items-center gap-2 w-full px-3 py-2 text-xs text-base-content/50 hover:text-base-content/70 transition-colors bg-base-200/50"
        onClick={() => setOpen((v) => !v)}
      >
        <BrainCircuit size={12} className={isStreaming ? 'text-sky-400 animate-pulse' : 'text-base-content/40'} />
        <span>Thinking</span>
        {isStreaming && <span className="loading loading-dots loading-xs ml-1" />}
        <ChevronDown size={12} className={`ml-auto transition-transform duration-150 ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="px-3 py-2 text-xs text-base-content/50 font-mono whitespace-pre-wrap max-h-60 overflow-y-auto bg-base-200/20">
          {content}
          {isStreaming && <span className="inline-block h-3 w-0.5 animate-pulse bg-current ml-0.5" />}
        </div>
      )}
    </div>
  );
}

// ─── AgentTurnBubble ──────────────────────────────────────────────────────────

export function AgentTurnBubble({ turn, toolActivities, answeredCallIds, renderedMessages }: Props) {
  const { messages, sessions, sessionMessages, streamingChunks, thinkingChunks } = useSessionStore();
  const turnMessages = renderedMessages ?? messages;
  const [submittedBudgetRequestId, setSubmittedBudgetRequestId] = useState<string | null>(null);
  const {
    callIdToName: persistentCallIdToName,
    toolArgProgress,
    setCanvasFocus,
    cliChildProjections,
    pendingBudgetApprovals,
    removePendingBudgetApproval,
    pendingConfirmations,
    queuedDepthBySession,
    sessionStatusSnapshots,
    runtimeActivitySnapshots,
  } = useAgentStore();
  const pendingBudgetApprovalsForTurn = pendingBudgetApprovals[turn.sessionId] ?? [];

  useEffect(() => {
    if (!pendingBudgetApprovalsForTurn.some((request) => request.requestId === submittedBudgetRequestId)) {
      setSubmittedBudgetRequestId(null);
    }
  }, [pendingBudgetApprovalsForTurn, submittedBudgetRequestId]);

  // Build callId → toolName from all available sources
  const toolCallIdToName = new Map<string, string>(Object.entries(persistentCallIdToName));
  for (const msg of turnMessages) {
    if (msg.role === 'assistant' && msg.toolCalls) {
      for (const tc of msg.toolCalls) toolCallIdToName.set(tc.id, tc.name);
    }
  }
  for (const a of toolActivities) toolCallIdToName.set(a.callId, a.toolName);

  // Build callId → args from assistant messages (for HistoryToolCallBubble)
  const toolArgsByCallId = new Map<string, Record<string, unknown>>();
  for (const msg of turnMessages) {
    if (msg.role === 'assistant' && msg.toolCalls) {
      for (const tc of msg.toolCalls) toolArgsByCallId.set(tc.id, tc.args);
    }
  }
  // Also pick up args from current-turn toolActivities (may not be persisted yet)
  for (const a of toolActivities) toolArgsByCallId.set(a.callId, a.args);

  // Build tool result lookup by callId
  const toolResultByCallId = new Map<string, { content: string; status: 'success' | 'error' | 'cancelled'; parsed: unknown }>();
  for (const msg of turnMessages) {
    if (msg.role === 'tool_result' && msg.toolCallId) {
      const parsed = (() => {
        try {
          return JSON.parse(msg.content) as unknown;
        } catch {
          return msg.content;
        }
      })();
      toolResultByCallId.set(msg.toolCallId, {
        content: msg.content,
        status: extractPersistedToolResultMeta(parsed)?.status ?? 'success',
        parsed,
      });
    }
  }

  const workflowTurnProjection = resolveWorkflowTurnProjection(turn, turnMessages, toolArgsByCallId);
  const architectureRun = workflowTurnProjection.architectureRun;
  const turnArchitectureRun = architectureRun && turn.items.some((item) => {
    if (item.kind === 'text') {
      return turnMessages.some((message) => message.id === item.messageId && (message.architectureRun || /^###\s+(Router|Finalizer)\b/im.test(message.content)));
    }
    if (item.kind === 'tool') {
      return toolCallIdToName.get(item.callId) === 'run_subagent';
    }
    return false;
  })
    ? workflowTurnProjection.persistedArchitectureMessage?.architectureRun || turn.done
      ? architectureRun
      : { ...architectureRun, status: 'running' as const }
    : null;
  const architectureFinalAnswer = turnArchitectureRun
    ? finalAnswerForArchitectureRun(turnArchitectureRun)
    : null;
  const visibleItems = deriveVisibleTurnItems(turn.items, turnMessages, streamingChunks, turn.done);
  const turnBranchSessionIds = workflowTurnProjection.branchSessionIds;
  const knownBranchSessionIds = useMemo(() => {
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
    return new Set(
      renderableSessions
        .filter((session) => (
          turnBranchSessionIds.has(session.id)
          || (turnArchitectureRun && sameArchitectureRunId(architectureRunIdForSession(session), turnArchitectureRun.runId))
          || (
          liveSessionIds.has(session.id)
          || (sessionMessages?.[session.id]?.length ?? 0) > 0
          )
        ))
        .map((session) => session.id),
    );
  }, [
    pendingBudgetApprovals,
    pendingConfirmations,
    queuedDepthBySession,
    runtimeActivitySnapshots,
    sessionMessages,
    sessionStatusSnapshots,
    sessions,
    turnArchitectureRun,
    turnBranchSessionIds,
  ]);

  return (
    <div data-testid="agent-turn-bubble" className="flex justify-start mb-2 w-full">
      <div className="min-w-0 w-full max-w-none">
        <p className="text-xs text-base-content/50 mb-1 ml-1">
          {turn.agentRun?.agentType === 'subagent' ? (turn.agentRun.label ?? 'Sub-agent') : 'Kalio'}
        </p>

        <div className={`group relative rounded-xl text-base-content text-sm px-2.5 py-1.5 flex flex-col gap-1 w-full ${turn.agentRun?.agentType === 'subagent' ? 'bg-sky-500/10 border border-sky-500/20' : 'bg-base-300'}`}>
          {turnArchitectureRun && (
            <>
              <ArchitectureRunTimeline
                run={turnArchitectureRun}
                knownBranchSessionIds={knownBranchSessionIds}
                onOpenCanvas={() => {
                  setCanvasFocus({ kind: 'architecture-run', runId: turnArchitectureRun.runId });
                }}
                onOpenBranch={(sessionId) => {
                  setCanvasFocus({ kind: 'architecture-branch', sessionId });
                }}
                onOpenStep={(focus) => {
                  setCanvasFocus({ kind: 'architecture-run', runId: turnArchitectureRun.runId, ...focus });
                }}
              />
              {architectureFinalAnswer && (
                <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/5 px-3 py-2" data-testid="architecture-final-answer">
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-emerald-300/80">Final answer</p>
                  <MarkdownViewer content={architectureFinalAnswer} />
                </div>
              )}
            </>
          )}
          {/* Loading indicator while turn is active but no items have arrived yet */}
          {!turn.done && turn.items.length === 0 && (
            toolArgProgress ? (
              <span data-testid="turn-loading-indicator" className="text-xs text-base-content/60 font-mono tabular-nums">
                {toolArgProgress.totalChars > 0 ? (
                  <>
                    Writing <span className="text-base-content/80">{toolArgProgress.toolName}</span>…{' '}
                    {toolArgProgress.totalChars.toLocaleString()} chars · {toolArgProgress.charsPerSec.toLocaleString()}/s
                  </>
                ) : (
                  <>
                    Preparing <span className="text-base-content/80">{toolArgProgress.toolName}</span>…
                  </>
                )}
              </span>
            ) : (
              <span data-testid="turn-loading-indicator" className="loading loading-dots loading-xs" />
            )
          )}
          {visibleItems.map((item, idx) => {
            if (item.kind === 'tool') {
              const callId = item.callId;
              const toolName = toolCallIdToName.get(callId) ?? callId;
              const toolResult = toolResultByCallId.get(callId);
              const isAnswered = answeredCallIds?.has(callId) ?? false;
              const isArchitectureSubagentCall = turnArchitectureRun && toolName === 'run_subagent';
              if (isArchitectureSubagentCall) {
                return null;
              }
              
              // Check if this is a live (in-progress) tool or completed
              const liveActivity = toolActivities.find((a) => a.callId === callId);
              const parsedToolResult = toolResult?.parsed;
              const cliSnapshot = parsedToolResult !== undefined ? extractCLIAgentSessionSnapshot(parsedToolResult) : null;
              const cliResult = parsedToolResult !== undefined ? extractCLIAgentResult(parsedToolResult) : null;
              const cliProjection = selectCLIChildProjectionFromSources({
                runtimeActivitySnapshots,
                cliChildProjections,
                parentCallId: callId,
              });
              const cliStatus = isCliChildToolName(toolName)
                ? resolveCLIChildProjectionStatus({
                    snapshotStatus: cliSnapshot?.status,
                    liveProjectionStatus: cliProjection?.status,
                    activityStatus: liveActivity?.status,
                    resultStatus: toolResult?.status,
                    cliResult,
                  })
                : null;
              const shouldRenderCliAsLive = cliStatus ? shouldRenderLiveCliChildStatus(cliStatus) : false;
              
              if (shouldRenderCliAsLive || (liveActivity && !toolResult)) {
                // Live tool call (still running)
                const syntheticLiveActivity = liveActivity ?? {
                  callId,
                  toolName,
                  args: toolArgsByCallId.get(callId) ?? {},
                  sessionId: turn.sessionId,
                  status: 'running' as const,
                  startedAt: 0,
                  ...(parsedToolResult !== undefined
                    ? {
                        result: {
                          callId,
                          status: 'success' as const,
                          data: parsedToolResult,
                        },
                      }
                    : {}),
                };
                return <LiveToolCallBubble key={`${callId}-${idx}`} activity={syntheticLiveActivity} />;
              }
              
              // Completed tool call
              return (
                <HistoryToolCallBubble
                  key={`${callId}-${idx}`}
                  toolName={toolName}
                  content={toolResult?.content ?? ''}
                  isAnswered={isAnswered}
                  args={toolArgsByCallId.get(callId)}
                  callId={callId}
                  parentSessionId={turn.sessionId}
                />
              );
            }

            if (item.kind === 'thinking') {
              const messageId = item.messageId;
              const msg = turnMessages.find((m) => m.id === messageId);
              // Prefer live chunk (streaming); fall back to persisted msg.thinking for history
              const thinkingContent = thinkingChunks[messageId] ?? msg?.thinking ?? '';
              if (!thinkingContent) return null;
              const isThinkingStreaming = thinkingChunks[messageId] !== undefined;
              return <ThinkingBlock key={`think-${messageId}`} content={thinkingContent} isStreaming={isThinkingStreaming} />;
            }

            // text item
            const messageId = item.messageId;
            const msg = turnMessages.find((m) => m.id === messageId);
            if (!msg) return null;
            if (turnArchitectureRun && isArchitectureTextOutput(msg.content, msg.architectureRun != null)) {
              return null;
            }
            
            // Use per-message streaming state: cursor blinks only while this message's
            // chunk is still live (disappears as soon as agent calls a tool / thinking / raapp).
            const isStreaming = isMessageLiveStreaming(messageId, msg, streamingChunks, turn.done);
            const displayContent = isStreaming ? (streamingChunks[messageId] ?? '') : msg.content;

            return (
              <div key={`text-${messageId}`} className="flex flex-col gap-2">
                {isStreaming && !displayContent ? (
                  <span data-testid="streaming-indicator" className="loading loading-dots loading-xs" />
                ) : displayContent ? (
                  <div>
                    <MarkdownViewer content={displayContent} />
                    {isStreaming && <span className="ml-0.5 inline-block h-3.5 w-0.5 animate-pulse bg-current" />}
                  </div>
                ) : null}
              </div>
            );
          })}
          {turn.error && (
            <div data-testid="turn-error-indicator" className="flex items-center gap-1.5 text-xs text-warning/80 pt-1 border-t border-base-content/10">
              <span>⚠</span>
              <span>
                {turn.error.code === 'INTERRUPTED'
                  ? 'Interrupted'
                  : turn.error.code === 'MAX_ITERATIONS_REACHED'
                    ? 'Reached iteration limit'
                    : turn.error.message}
              </span>
            </div>
          )}
          {pendingBudgetApprovalsForTurn.length > 0 && !turn.done && (
            <div className="space-y-2">
              {pendingBudgetApprovalsForTurn.map((pendingBudgetApproval) => (
                <div
                  key={pendingBudgetApproval.requestId}
                  className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning/85"
                  data-testid="turn-budget-approval"
                >
                  <div className="font-medium">
                    Agent reached tool loop limit {pendingBudgetApproval.usedIterations}/{pendingBudgetApproval.currentLimit}
                  </div>
                  <div className="mt-1 text-warning/70">
                    Continue with more tool requests for this run.
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {[
                      ['block', 'Block'],
                      ['allow_one', '+1'],
                      ['allow_ten', '+10'],
                      ['allow_unlimited', 'Unlimited'],
                    ].map(([decision, label]) => (
                      <button
                        key={decision}
                        className={`btn btn-xs ${decision === 'block' ? 'btn-ghost' : 'btn-warning'}`}
                        onClick={() => {
                          if (submittedBudgetRequestId === pendingBudgetApproval.requestId) {
                            return;
                          }
                          setSubmittedBudgetRequestId(pendingBudgetApproval.requestId);
                          eventBus.approveAgentBudget({
                            requestId: pendingBudgetApproval.requestId,
                            sessionId: pendingBudgetApproval.sessionId,
                            decision: decision as 'block' | 'allow_one' | 'allow_ten' | 'allow_unlimited',
                          });
                          if (decision === 'block') {
                            removePendingBudgetApproval(pendingBudgetApproval.sessionId, pendingBudgetApproval.requestId);
                          }
                        }}
                        disabled={submittedBudgetRequestId === pendingBudgetApproval.requestId}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function isArchitectureTextOutput(content: string, hasRunMetadata: boolean): boolean {
  if (hasRunMetadata) {
    return true;
  }
  return /^###\s+(Router|Finalizer)\b/im.test(content)
    || /^Architecture run\s+(running|completed|failed):/im.test(content)
    || /^Execution trace:/im.test(content)
    || /^Executed route:/im.test(content);
}

function finalAnswerForArchitectureRun(
  run: NonNullable<ReturnType<typeof resolveWorkflowTurnProjection>['architectureRun']>,
): string | null {
  if (run.finalArtifact?.trim()) {
    return run.finalArtifact;
  }
  const finalizer = [...run.trace]
    .reverse()
    .find((step) => step.speaker === 'finalizer' && step.content.trim().length > 0);
  return finalizer?.content.trim() ?? null;
}
