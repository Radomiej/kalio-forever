import { useEffect, useState } from 'react';
import { AlertTriangle, BotMessageSquare, Zap, Brain, StopCircle, Play, X } from 'lucide-react';
import type { RuntimeActivitySnapshot } from '@kalio/types';
import { useAgentStore } from '../../store/agentStore';
import type { LlmActivity, ToolActivity } from '../../store/agentStore';
import { ToolActivityRow } from '../chat/ToolActivityRow';
import { useSessionStore } from '../../store/sessionStore';
import { eventBus } from '../../services/eventBus';
import { HomeHitlInbox } from '../landing/HomeHitlInbox';
import { resumeAgentFlowRun } from '../agent-flow/agentFlow.api';
import { usePendingRaAppApprovals } from '../raapp/usePendingRaAppApprovals';
import {
  selectPendingApprovalCount,
  selectRuntimeContinuationActions,
  selectRunningLoops,
  selectRuntimeAttentionItems,
} from '../../store/agentRuntimeSelectors';
import {
  readReviewedRuntimeAttentionKeys,
  selectRuntimeAttentionNotice,
  writeReviewedRuntimeAttentionKeys,
} from '../../store/agentRuntimeAttentionNotice';

function projectToolActivityForRuntimeState(
  activity: ToolActivity,
  runtimeActivitySnapshots: Record<string, RuntimeActivitySnapshot>,
): ToolActivity {
  const snapshot = activity.sessionId ? runtimeActivitySnapshots[activity.sessionId] : undefined;
  if (
    snapshot?.run?.status === 'interrupted_needs_retry'
    && (activity.status === 'running' || activity.status === 'awaiting_confirmation')
  ) {
    return {
      ...activity,
      status: 'expired',
      finishedAt: activity.finishedAt ?? snapshot.updatedAt,
    };
  }

  return activity;
}

export function ConversationManagerPanel({
  onNavigate,
  onOpenSession,
}: { onNavigate?: () => void; onOpenSession?: (sessionId: string) => void }) {
  const toolActivities = useAgentStore((s) => s.toolActivities);
  const llmActivities = useAgentStore((s) => s.llmActivities);
  const runtimeActivitySnapshots = useAgentStore((s) => s.runtimeActivitySnapshots);
  const pendingConfirmations = useAgentStore((s) => s.pendingConfirmations);
  const pendingBudgetApprovals = useAgentStore((s) => s.pendingBudgetApprovals);
  const clearInactiveActivities = useAgentStore((s) => s.clearInactiveActivities);
  const sessions = useSessionStore((s) => s.sessions);
  const sessionMessages = useSessionStore((s) => s.sessionMessages);
  const pendingRaAppApprovals = usePendingRaAppApprovals(sessionMessages);
  const [resumingFlowRunId, setResumingFlowRunId] = useState<string | null>(null);
  const [resumeError, setResumeError] = useState<string | null>(null);
  const [runtimeAttentionNowMs, setRuntimeAttentionNowMs] = useState(() => Date.now());
  const [reviewedRuntimeAttentionKeys, setReviewedRuntimeAttentionKeys] = useState(readReviewedRuntimeAttentionKeys);

  const runningLoops = selectRunningLoops({ runtimeActivitySnapshots });
  const toolBudgetProgresses = Object.values(runtimeActivitySnapshots)
    .flatMap((snapshot) => (snapshot.toolBudgetProgress ? [snapshot.toolBudgetProgress] : []))
    .sort((left, right) => right.updatedAt - left.updatedAt);
  const attentionItems = selectRuntimeAttentionItems({
    pendingConfirmations,
    pendingBudgetApprovals,
    pendingRaAppApprovals: pendingRaAppApprovals.approvals,
    runtimeActivitySnapshots,
    sessions,
    sessionMessages,
  });
  const continuationActions = selectRuntimeContinuationActions({
    runtimeActivitySnapshots,
    sessions,
    sessionMessages,
  });
  const continuationSessionIds = new Set(continuationActions.map((action) => action.sessionId));
  const runtimeAttentionItems = attentionItems
    .filter((item) => !item.actionable && !continuationSessionIds.has(item.sessionId));
  const runtimeAttentionNotice = selectRuntimeAttentionNotice({
    items: runtimeAttentionItems,
    runtimeActivitySnapshots,
    sessions,
    sessionMessages,
    nowMs: runtimeAttentionNowMs,
    reviewedItemKeys: reviewedRuntimeAttentionKeys,
  });
  const runtimeAttentionNoticeMaxUpdatedAt = runtimeAttentionNotice?.maxUpdatedAt;
  const runtimeAttentionNoticeNextExpiresInMs = runtimeAttentionNotice?.nextExpiresInMs;
  const pendingConfirmationCount = selectPendingApprovalCount({
    pendingConfirmations,
    pendingBudgetApprovals,
    pendingRaAppApprovals: pendingRaAppApprovals.approvals,
    sessionMessages,
  });
  const projectedToolActivities = toolActivities.map((activity) => (
    projectToolActivityForRuntimeState(activity, runtimeActivitySnapshots)
  ));
  const active = projectedToolActivities.filter(
    (a) => a.status === 'running' || a.status === 'awaiting_confirmation',
  );
  const done = projectedToolActivities.filter(
    (a) => a.status !== 'running' && a.status !== 'awaiting_confirmation',
  );
  const hasRunningLlmActivity = llmActivities.some((activity) => activity.status === 'running');
  const hasLiveRuntime = runningLoops.length > 0 || hasRunningLlmActivity;
  const inactiveLlmCount = llmActivities.filter((a) => a.status !== 'running').length;
  const inactiveCount = done.length + inactiveLlmCount;
  const hasActionableAttention = attentionItems.some((item) => item.actionable);
  const hasAttention = hasActionableAttention || runtimeAttentionNotice !== null;
  const hasContinuationActions = continuationActions.length > 0;
  const openAttentionSession = (sessionId: string) => {
    if (onOpenSession) {
      onOpenSession(sessionId);
      return;
    }
    onNavigate?.();
  };
  const resumeContinuation = (flowRunId: string, input: string) => {
    if (resumingFlowRunId === flowRunId) {
      return;
    }
    setResumingFlowRunId(flowRunId);
    setResumeError(null);
    void resumeAgentFlowRun(flowRunId, { input })
      .catch((err: unknown) => {
        console.error('[ConversationManagerPanel] failed to resume AgentFlow run', err instanceof Error ? err : new Error(String(err)));
        setResumeError('Resume request failed. Reconnect and retry.');
      })
      .finally(() => {
        setResumingFlowRunId((current) => (current === flowRunId ? null : current));
      });
  };
  const dismissRuntimeAttentionNotice = () => {
    if (!runtimeAttentionNotice) {
      return;
    }
    const nextKeys = new Set(reviewedRuntimeAttentionKeys);
    runtimeAttentionNotice.reviewKeys.forEach((key) => nextKeys.add(key));
    writeReviewedRuntimeAttentionKeys(nextKeys);
    setReviewedRuntimeAttentionKeys(nextKeys);
  };

  useEffect(() => {
    if (runtimeAttentionNoticeNextExpiresInMs === undefined) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      setRuntimeAttentionNowMs(Date.now());
    }, runtimeAttentionNoticeNextExpiresInMs);

    return () => window.clearTimeout(timeoutId);
  }, [runtimeAttentionNoticeMaxUpdatedAt, runtimeAttentionNoticeNextExpiresInMs]);

  const isEmpty = runningLoops.length === 0
    && !hasRunningLlmActivity
    && toolActivities.length === 0
    && llmActivities.length === 0
    && pendingConfirmationCount === 0
    && toolBudgetProgresses.length === 0
    && !hasActionableAttention
    && runtimeAttentionNotice === null
    && continuationActions.length === 0;

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
      {pendingConfirmationCount > 0 && (
        <div className="shrink-0 px-2 pt-2">
          <HomeHitlInbox
            onOpenSession={onOpenSession ?? onNavigate ?? (() => undefined)}
            raAppApprovals={pendingRaAppApprovals.approvals}
            onRaAppApprovalSettled={pendingRaAppApprovals.markSettled}
          />
        </div>
      )}

      {continuationActions.length > 0 && (
        <div className="shrink-0 px-2 pt-2 pb-1 flex flex-col gap-1">
          <p className="text-[10px] uppercase tracking-wider text-base-content/30 px-2 pb-0.5">Runtime actions</p>
          {continuationActions.map((action) => (
            <div
              key={action.id}
              className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-2.5 py-2 text-left"
              data-testid={`runtime-continuation-${action.flowRunId}`}
            >
              <Play size={12} className="mt-0.5 shrink-0 text-warning" />
              <button
                type="button"
                className="min-w-0 flex-1 text-left"
                onClick={() => openAttentionSession(action.sessionId)}
              >
                <div className="truncate text-xs font-medium text-base-content/85">{action.label}</div>
                <p className="mt-0.5 text-[11px] leading-relaxed text-base-content/55">{action.detail}</p>
              </button>
              <button
                type="button"
                className="btn btn-warning btn-xs h-7 min-h-0 shrink-0 px-2"
                onClick={() => resumeContinuation(action.flowRunId, action.input)}
                disabled={resumingFlowRunId === action.flowRunId}
              >
                Resume AgentFlow
              </button>
            </div>
          ))}
          {resumeError && (
            <p className="px-2 text-[11px] text-error">{resumeError}</p>
          )}
          {(runtimeAttentionItems.length > 0 || runningLoops.length > 0 || active.length > 0 || done.length > 0 || llmActivities.length > 0) && (
            <div className="border-t border-base-300/40 mt-1" />
          )}
        </div>
      )}

      {runtimeAttentionNotice && (
        <div
          className="shrink-0 px-2 pt-2 pb-1"
          data-testid="runtime-attention-notice"
          role="status"
          aria-live="polite"
        >
          <div className="rounded-lg border border-warning/25 bg-warning/8">
            <div className="flex items-start gap-2 px-2.5 py-2">
              <AlertTriangle size={13} className="mt-0.5 shrink-0 text-warning" />
              <div className="min-w-0 flex-1">
                <p className="text-[10px] uppercase tracking-wider text-base-content/35">Runtime attention</p>
                <p className="text-xs font-medium text-base-content/85">
                  {runtimeAttentionNotice.totalRecentCount} runtime issue{runtimeAttentionNotice.totalRecentCount === 1 ? '' : 's'} in the last 5 minutes
                </p>
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-xs h-6 min-h-0 w-6 shrink-0 p-0 text-base-content/45 hover:text-base-content"
                aria-label="Dismiss runtime attention notice"
                title="Dismiss runtime attention notice"
                onClick={dismissRuntimeAttentionNotice}
              >
                <X size={12} />
              </button>
            </div>
            <div className="border-t border-warning/15">
              {runtimeAttentionNotice.items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="flex w-full items-start gap-2 px-2.5 py-2 text-left transition-colors hover:bg-warning/10"
                  data-testid={`runtime-attention-${item.sessionId}`}
                  aria-label={`${item.label}. ${item.detail}`}
                  onClick={() => openAttentionSession(item.sessionId)}
                >
                  <AlertTriangle
                    size={12}
                    className={`mt-0.5 shrink-0 ${
                      item.kind === 'runtime_waiting' ? 'text-warning' : 'text-error'
                    }`}
                  />
                  <div className="min-w-0 flex-1" data-testid={`runtime-attention-row-${item.sessionId}`}>
                    <div className="truncate text-xs font-medium text-base-content/85">{item.label}</div>
                    <p
                      data-testid={`runtime-attention-detail-${item.sessionId}`}
                      className="mt-0.5 max-h-14 overflow-hidden text-[11px] leading-relaxed text-base-content/55 [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:3]"
                    >
                      {item.detail}
                    </p>
                  </div>
                </button>
              ))}
              {runtimeAttentionNotice.hiddenRecentCount > 0 && (
                <p className="border-t border-warning/10 px-2.5 py-1.5 text-[11px] text-base-content/45">
                  +{runtimeAttentionNotice.hiddenRecentCount} more in Needs attention
                </p>
              )}
            </div>
          </div>
          {(runningLoops.length > 0 || active.length > 0 || done.length > 0 || llmActivities.length > 0) && (
            <div className="border-t border-base-300/40 mt-1" />
          )}
        </div>
      )}

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

      {toolBudgetProgresses.length > 0 && (
        <div className="px-2 pt-2 pb-1 flex flex-col gap-1 shrink-0">
          <p className="text-[10px] uppercase tracking-wider text-base-content/30 px-2 pb-0.5">Tool budget</p>
          {toolBudgetProgresses.slice(0, 4).map((progress) => {
            const session = sessions.find((candidate) => candidate.id === progress.sessionId);
            return (
              <div
                key={`${progress.sessionId}:${progress.roleSlotId ?? progress.messageId ?? progress.updatedAt}`}
                className="flex items-center gap-2 rounded-lg border border-base-300/60 bg-base-200/45 px-2 py-1.5 text-xs"
                data-testid={`tool-budget-progress-${progress.sessionId}`}
              >
                <span className="min-w-0 flex-1 truncate text-base-content/70">
                  {session?.title ?? progress.roleSlotId ?? progress.sessionId}
                </span>
                <span className="font-mono text-base-content/80">{progress.usedIterations}/{progress.currentLimit}</span>
                <span className="badge badge-xs badge-ghost">{progress.status}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* Status bar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-base-300 shrink-0">
        {hasLiveRuntime ? (
          <>
            <Zap size={12} className="text-sky-400 animate-pulse" />
            <span className="text-xs text-sky-400 font-medium">Agent running</span>
          </>
        ) : hasAttention || hasContinuationActions ? (
          <>
            <AlertTriangle size={12} className="text-warning" />
            <span className="text-xs text-warning font-medium">Needs attention</span>
          </>
        ) : (
          <>
            <Zap size={12} className="text-base-content/30" />
            <span className="text-xs text-base-content/40">Last run</span>
          </>
        )}
        <span className="ml-auto text-xs text-base-content/30">{toolActivities.length} call{toolActivities.length !== 1 ? 's' : ''}{llmActivities.length > 0 ? ` · ${llmActivities.length} llm` : ''}</span>
        {inactiveCount > 0 && (
          <button
            type="button"
            className="btn btn-ghost btn-xs h-6 min-h-0 px-2 text-base-content/45 hover:text-base-content"
            onClick={clearInactiveActivities}
            data-testid="clear-inactive-agents"
            title="Remove finished activity from this panel"
          >
            Clear inactive
          </button>
        )}
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

