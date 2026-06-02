/**
 * ToolCallBubble — unified chip for a single tool call.
 *
 * Architecture: one item per toolCallId, driven by a merged status:
 *   running | awaiting_confirmation | success | error | cancelled
 *
 * While running: spinner + args (no widget).
 * Once tool_result lands in ChatMessage: result shown inline, widget rendered.
 * Once user answers (isAnswered): widget collapses to "answer submitted".
 *
 * Two named exports kept for AgentTurnBubble compatibility:
 *   LiveToolCallBubble   — tool still in-flight (ToolActivity, no result yet)
 *   HistoryToolCallBubble — tool finished (tool_result ChatMessage)
 */
import { useEffect, useState, useMemo } from 'react';
import { CheckCircle2, XCircle, Loader2, ChevronDown, ExternalLink, AlertTriangle } from 'lucide-react';
import type { AgentFlowRunSnapshot, SubAgentFlowResult } from '@kalio/types';
import type { ToolActivity } from '../../store/agentStore';
import { useAgentStore } from '../../store/agentStore';
import { eventBus } from '../../services/eventBus';
import { apiClient } from '../../services/apiClient';

import { RAAppRenderer } from '../raapp/RAAppRenderer';
import { TerminalOutputBlock } from './TerminalOutputBlock';
import { LiveCLIAgentBlock } from './LiveCLIAgentBlock';
import { ImageResultRenderer } from './ImageResultRenderer';
import {
  extractCLIAgentResult,
  extractCLIAgentSessionSnapshot,
  extractImageResult,
  extractRAAppBlock,
  extractSubAgentFlowResult,
  extractSubagentResult,
} from './ToolCallBubble.parsers';
import { SubagentResultBlock, CLIAgentSessionStatusBlock, SubAgentFlowResultBlock } from './ToolCallBubble.ResultBlocks';
import { getToolTargetLabel } from './toolTargetLabel';

export { extractRAAppBlock } from './ToolCallBubble.parsers';

const DURABLE_CLI_AGENT_TOOLS = new Set([
  'spawn_cli_agent',
  'message_cli_agent',
  'get_cli_agent_status',
  'stop_cli_agent',
]);

// ─── helpers ─────────────────────────────────────────────────────────────────

function formatMs(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function formatArgValue(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'string') return value.length > 100 ? value.slice(0, 100) + '…' : value;
  const str = JSON.stringify(value);
  return str.length > 100 ? str.slice(0, 100) + '…' : str;
}

// ─── Chip chrome ─────────────────────────────────────────────────────────────

function subAgentFlowResultFromSnapshot(snapshot: AgentFlowRunSnapshot): SubAgentFlowResult {
  if (snapshot.result) {
    return {
      ...snapshot.result,
      returnToOrchestratorCount: snapshot.result.returnToOrchestratorCount
        ?? snapshot.run.returnToOrchestratorCount,
    };
  }
  return {
    flowRunId: snapshot.run.id,
    childSessionId: snapshot.run.childSessionId,
    status: snapshot.run.status,
    summary: snapshot.run.summary ?? `AgentFlow ${snapshot.run.flowDefinitionId} is ${snapshot.run.status}.`,
    decisions: [],
    nextActions: [],
    artifacts: [],
    returnToOrchestratorCount: snapshot.run.returnToOrchestratorCount,
    tracePreview: snapshot.events,
    openChatSessionId: snapshot.run.openChatSessionId,
    openGraphRunId: snapshot.run.openGraphRunId,
  };
}

function Chip({
  icon,
  toolName,
  targetLabel,
  badge,
  elapsed,
  expandable,
  open,
  onToggle,
  children,
}: {
  icon: React.ReactNode;
  toolName: string;
  targetLabel?: string | null;
  badge?: React.ReactNode;
  elapsed?: number | null;
  expandable: boolean;
  open: boolean;
  onToggle: () => void;
  children?: React.ReactNode;
}) {
  return (
    <div
      data-testid="tool-call-bubble"
      data-tool-name={toolName}
      className="border-l-[3px] border-l-emerald-500/40 pl-3 py-1 my-1"
    >
      <div data-testid="tool-call-chip" className="flex items-center gap-1.5 flex-wrap">
        {icon}
        <span className="font-mono text-xs text-sky-400">{toolName}</span>
        {targetLabel && (
          <span
            data-testid="tool-call-target"
            className="min-w-0 max-w-[16rem] truncate font-mono text-[10px] text-base-content/45"
            title={targetLabel}
          >
            {targetLabel}
          </span>
        )}
        {badge}
        {elapsed != null && (
          <span className="text-[10px] font-mono text-base-content/30">{formatMs(elapsed)}</span>
        )}
        {expandable && (
          <button
            className="ml-auto text-base-content/30 hover:text-base-content/60 transition-colors"
            onClick={onToggle}
            aria-label="Toggle details"
          >
            <ChevronDown
              size={11}
              className={`transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
            />
          </button>
        )}
      </div>
      {open && children && (
        <div className="mt-2 space-y-1">{children}</div>
      )}
    </div>
  );
}

// ─── Inline confirmation bubble — shown inside tool chip when awaiting decision ─

function ConfirmationInlineBubble({ activity }: { activity: ToolActivity }) {
  const [argsOpen, setArgsOpen] = useState(false);
  const pendingConfirmations = useAgentStore((s) => s.pendingConfirmations);
  const toolArgProgress = useAgentStore((s) => s.toolArgProgress);
  const setPendingConfirmation = useAgentStore((s) => s.setPendingConfirmation);
  const updateToolActivity = useAgentStore((s) => s.updateToolActivity);
  const confirmation = Object.values(pendingConfirmations).find((pending) => pending.toolCallId === activity.callId);
  const matchingToolProgress = toolArgProgress?.toolName === activity.toolName ? toolArgProgress : null;

  const isMatch = confirmation != null;

  const argEntries = Object.entries(activity.args);
  const argPreview = argEntries.length === 0
    ? null
    : `${argEntries[0][0]}: ${formatArgValue(argEntries[0][1])}${argEntries.length > 1 ? ' …' : ''}`;
  const targetLabel = getToolTargetLabel(activity.toolName, activity.args);

  const handleConfirm = () => {
    if (!confirmation) return;
    updateToolActivity(activity.callId, { status: 'running', startedAt: Date.now() });
    eventBus.confirmTool({ requestId: confirmation.requestId, sessionId: confirmation.sessionId });
    setPendingConfirmation(confirmation.sessionId, null);
  };

  const handleCancel = () => {
    if (!confirmation) return;
    updateToolActivity(activity.callId, { status: 'cancelled', finishedAt: Date.now() });
    eventBus.cancelTool({ requestId: confirmation.requestId, sessionId: confirmation.sessionId });
    setPendingConfirmation(confirmation.sessionId, null);
  };

  return (
    <div
      data-testid="tool-call-bubble"
      className="border-l-[3px] border-l-amber-400/70 pl-3 py-1.5 my-1"
    >
      <div data-testid="tool-call-chip" className="flex items-center gap-1.5 flex-wrap">
        <AlertTriangle size={12} className="text-warning animate-pulse shrink-0" data-testid="awaiting-confirmation-icon" />
        <span className="font-mono text-xs text-amber-400">{activity.toolName}</span>
        {targetLabel && (
          <span
            data-testid="tool-call-target"
            className="min-w-0 max-w-[16rem] truncate font-mono text-[10px] text-base-content/45"
            title={targetLabel}
          >
            {targetLabel}
          </span>
        )}
        <span className="text-[10px] font-mono text-warning/70 bg-warning/10 rounded px-1">awaiting confirmation</span>
        {argPreview && (
          <button
            className="ml-auto text-base-content/30 hover:text-base-content/60 transition-colors"
            onClick={() => setArgsOpen((v) => !v)}
            aria-label="Toggle args"
            data-testid="confirmation-args-toggle"
          >
            <ChevronDown size={11} className={`transition-transform duration-150 ${argsOpen ? 'rotate-180' : ''}`} />
          </button>
        )}
      </div>

      {/* Collapsed preview */}
      {argPreview && !argsOpen && (
        <div className="mt-1 font-mono text-[10px] text-base-content/30 truncate" data-testid="args-preview">
          {argPreview}
        </div>
      )}

      {matchingToolProgress && (
        <div data-testid="tool-arg-progress-indicator" className="mt-1 font-mono text-[10px] text-base-content/45">
          {matchingToolProgress.totalChars > 0 ? (
            <>
              Writing <span className="text-base-content/65">{activity.toolName}</span>…{' '}
              {matchingToolProgress.totalChars.toLocaleString()} chars · {matchingToolProgress.charsPerSec.toLocaleString()}/s
            </>
          ) : (
            <>
              Preparing <span className="text-base-content/65">{activity.toolName}</span>…
            </>
          )}
        </div>
      )}

      {/* Expanded scrollable args */}
      {argsOpen && argEntries.length > 0 && (
        <div className="mt-1.5 font-mono bg-base-200/60 rounded px-2 py-1 max-h-40 overflow-y-auto text-xs text-base-content/50" data-testid="args-expanded">
          {argEntries.map(([k, v]) => (
            <div key={k}>
              <span className="text-base-content/40">{k}:</span> {formatArgValue(v)}
            </div>
          ))}
        </div>
      )}

      {/* Action buttons — only shown when this is the active session's pending confirmation */}
      {isMatch && (
        <div className="flex gap-2 mt-2" data-testid="confirmation-actions">
          <button
            data-testid="confirmation-confirm-btn"
            className="btn btn-success btn-xs"
            onClick={handleConfirm}
          >
            Confirm
          </button>
          <button
            data-testid="confirmation-cancel-btn"
            className="btn btn-ghost btn-xs"
            onClick={handleCancel}
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Live chip — running/awaiting/error from ToolActivity ─────────────────────
// Widget is NEVER rendered here. It appears in HistoryToolCallBubble once the
// tool_result ChatMessage lands in the session store.

export function LiveToolCallBubble({ activity }: { activity: ToolActivity }) {
  const [manualOpen, setManualOpen] = useState<boolean | null>(null);
  const elapsed = activity.finishedAt != null ? activity.finishedAt - activity.startedAt : null;
  const toolActivities = useAgentStore((s) => s.toolActivities);
  const descendantActivities = useMemo(
    () =>
      activity.toolName !== 'run_subagent'
        ? []
        : toolActivities
            .filter((candidate) => candidate.agentRun?.parentToolCallId === activity.callId)
            .slice()
            .sort((left, right) => {
              if (left.status === right.status) {
                return left.startedAt - right.startedAt;
              }
              if (left.status === 'awaiting_confirmation') return -1;
              if (right.status === 'awaiting_confirmation') return 1;
              return left.startedAt - right.startedAt;
            }),
    [activity.callId, activity.toolName, toolActivities],
  );

  // Awaiting confirmation gets its own dedicated inline bubble with action buttons
  if (activity.status === 'awaiting_confirmation') {
    return <ConfirmationInlineBubble activity={activity} />;
  }

  const icon =
    activity.status === 'running' ? (
      <Loader2 size={12} className="text-sky-400 animate-spin shrink-0" />
    ) : activity.status === 'success' ? (
      <CheckCircle2 size={12} className="text-success shrink-0" />
    ) : activity.status === 'expired' ? (
      <AlertTriangle size={12} className="text-warning shrink-0" />
    ) : (
      <XCircle size={12} className={activity.status === 'cancelled' ? 'text-base-content/40 shrink-0' : 'text-error shrink-0'} />
    );

  const badge = activity.status === 'expired'
    ? <span className="text-[10px] font-mono text-warning/70 bg-warning/10 rounded px-1">confirmation expired</span>
    : activity.status === 'cancelled'
      ? <span className="text-[10px] font-mono text-base-content/55 bg-base-200/70 rounded px-1">cancelled</span>
      : activity.status === 'error'
        ? <span className="text-[10px] font-mono text-error/80 bg-error/10 rounded px-1">failed</span>
        : undefined;

  const hasArgs = Object.keys(activity.args).length > 0;
  const isRunningCliAgent = activity.toolName === 'run_cli_agent' && activity.status === 'running';
  const cliSessionSnapshot = DURABLE_CLI_AGENT_TOOLS.has(activity.toolName) && activity.result?.data != null
    ? extractCLIAgentSessionSnapshot(activity.result.data)
    : null;
  const hasNonRaappResult = activity.result?.data != null
    && extractRAAppBlock(activity.result.data) == null
    && extractImageResult(activity.result.data) == null
    && cliSessionSnapshot == null;
  const defaultOpen = descendantActivities.length > 0
    || isRunningCliAgent
    || cliSessionSnapshot != null
    || activity.status === 'cancelled'
    || activity.status === 'expired'
    || activity.status === 'error';
  const open = manualOpen ?? defaultOpen;
  const expandable = hasArgs || hasNonRaappResult || isRunningCliAgent || descendantActivities.length > 0 || cliSessionSnapshot != null;
  const imageResult = activity.result?.data != null ? extractImageResult(activity.result.data) : null;

  return (
    <Chip
      icon={icon}
      toolName={activity.toolName}
      targetLabel={getToolTargetLabel(activity.toolName, activity.args)}
      badge={badge}
      elapsed={elapsed}
      expandable={expandable}
      open={open}
      onToggle={() => setManualOpen((value) => !(value ?? defaultOpen))}
    >
      {descendantActivities.length > 0 && (
        <div className="space-y-2 rounded border border-base-300/60 bg-base-200/50 px-2 py-2">
          <div className="text-[10px] font-mono uppercase tracking-[0.14em] text-base-content/45">
            Sub-agent activity
          </div>
          {descendantActivities.map((childActivity) => (
            <div key={childActivity.callId} className="pl-2 border-l border-base-300/60">
              <LiveToolCallBubble activity={childActivity} />
            </div>
          ))}
        </div>
      )}
      {isRunningCliAgent && (
        <LiveCLIAgentBlock
          callId={activity.callId}
          agentId={(activity.args['agentId'] as string | undefined) ?? 'copilot'}
        />
      )}
      {cliSessionSnapshot && <CLIAgentSessionStatusBlock snapshot={cliSessionSnapshot} />}
      {imageResult && <ImageResultRenderer data={imageResult} />}
      {hasArgs && (
        <div className="font-mono bg-base-200/60 rounded px-2 py-1 text-xs text-base-content/50">
          {Object.entries(activity.args).map(([k, v]) => (
            <div key={k}>
              <span className="text-base-content/40">{k}:</span> {formatArgValue(v)}
            </div>
          ))}
        </div>
      )}
      {hasNonRaappResult && activity.result?.data != null && (
        <div className="font-mono bg-base-200/60 rounded px-2 py-1 max-h-40 overflow-y-auto whitespace-pre-wrap text-xs text-base-content/60">
          {JSON.stringify(activity.result.data, null, 2)}
        </div>
      )}
      {activity.result?.errorMessage && (
        <div className="text-xs text-error">{activity.result.errorMessage}</div>
      )}
      {activity.status === 'cancelled' && !activity.result?.errorMessage && (
        <div className="text-xs text-base-content/50">Tool call was cancelled before it completed.</div>
      )}
      {activity.status === 'expired' && !activity.result?.errorMessage && (
        <div className="text-xs text-warning/80">Confirmation timed out before the tool could run.</div>
      )}
    </Chip>
  );
}

// ─── History chip — completed tool_result from ChatMessage ────────────────────
// Widget renders inline here, in its chronological position within the agent turn.
// Collapses to "answer submitted" when user responds (isAnswered=true).

export function HistoryToolCallBubble({
  toolName,
  content,
  isAnswered,
  args,
  defaultOpenOverride,
}: {
  toolName: string;
  content: string;
  isAnswered?: boolean;
  args?: Record<string, unknown>;
  defaultOpenOverride?: boolean;
}) {
  const setCanvasOpen = useAgentStore((s) => s.setCanvasOpen);
  const setCanvasFocus = useAgentStore((s) => s.setCanvasFocus);
  const isSubagent = toolName === 'run_subagent';
  const isCliAgent = toolName === 'run_cli_agent';
  const isSubAgentFlow = toolName === 'run_sub_agentflow';
  const isDurableCliAgent = DURABLE_CLI_AGENT_TOOLS.has(toolName);

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    parsed = content;
  }

  const raapp = extractRAAppBlock(parsed);
  const cliResult = isCliAgent ? extractCLIAgentResult(parsed) : null;
  const cliSessionSnapshot = isDurableCliAgent ? extractCLIAgentSessionSnapshot(parsed) : null;
  const imageResult = extractImageResult(parsed);
  const subagentResult = isSubagent ? extractSubagentResult(parsed) : null;
  const subAgentFlowResult = isSubAgentFlow ? extractSubAgentFlowResult(parsed) : null;
  const [refreshedSubAgentFlowResult, setRefreshedSubAgentFlowResult] = useState<SubAgentFlowResult | null>(null);
  const displayedSubAgentFlowResult = refreshedSubAgentFlowResult ?? subAgentFlowResult;
  const hasArgs = args != null && Object.keys(args).length > 0;
  const inferredDefaultOpen = (raapp != null && !isAnswered) || cliResult != null || cliSessionSnapshot != null || imageResult != null || subagentResult != null || displayedSubAgentFlowResult != null;
  const defaultOpen = defaultOpenOverride ?? inferredDefaultOpen;
  const [manualOpen, setManualOpen] = useState<boolean | null>(null);
  const open = isAnswered ? false : (manualOpen ?? defaultOpen);

  const hasResult = !raapp && !cliResult && !cliSessionSnapshot && !imageResult && !subagentResult && !displayedSubAgentFlowResult && content.length > 0;
  const expandable = hasArgs || hasResult || (raapp != null && !isAnswered) || cliResult != null || cliSessionSnapshot != null || imageResult != null || subagentResult != null || displayedSubAgentFlowResult != null;
  const agentFlowOpenGraphRunId = displayedSubAgentFlowResult?.openGraphRunId ?? displayedSubAgentFlowResult?.flowRunId;

  useEffect(() => {
    if (!isSubAgentFlow || !subAgentFlowResult || subAgentFlowResult.status !== 'running') return;
    const runId = subAgentFlowResult?.openGraphRunId ?? subAgentFlowResult?.flowRunId;
    if (!runId) return;
    let cancelled = false;
    void apiClient.get<AgentFlowRunSnapshot>(`/api/agent-flows/runs/${runId}`)
      .then((response) => {
        if (!cancelled) {
          setRefreshedSubAgentFlowResult(subAgentFlowResultFromSnapshot(response.data));
        }
      })
      .catch((err: unknown) => {
        console.error('[ToolCallBubble] failed to refresh AgentFlow run', err instanceof Error ? err : new Error(String(err)));
      });
    return () => {
      cancelled = true;
    };
  }, [isSubAgentFlow, subAgentFlowResult?.flowRunId, subAgentFlowResult?.openGraphRunId, subAgentFlowResult?.status]);

  const handleOpenInCanvas = () => {
    if (displayedSubAgentFlowResult) {
      if (agentFlowOpenGraphRunId) {
        setCanvasFocus({ kind: 'architecture-run', runId: agentFlowOpenGraphRunId });
      }
    }
    setCanvasOpen(true);
  };

  return (
    <>
      <Chip
        icon={<CheckCircle2 size={12} className="text-success shrink-0" />}
        toolName={toolName}
        targetLabel={getToolTargetLabel(toolName, args)}
        badge={
          <>
            {isAnswered && <span className="text-[10px] font-mono text-base-content/40 bg-base-200/60 rounded px-1">↩ answered</span>}
            {(isSubagent || cliSessionSnapshot != null || displayedSubAgentFlowResult != null) && (
              <button
                className="ml-1 text-[10px] text-sky-400/60 hover:text-sky-400 flex items-center gap-0.5"
                title="View in canvas"
                data-testid={displayedSubAgentFlowResult != null ? 'open-agentflow-canvas' : isSubagent ? 'open-subagent-canvas' : 'open-cli-agent-canvas'}
                onClick={(e) => {
                  e.stopPropagation();
                  handleOpenInCanvas();
                }}
              >
                <ExternalLink size={9} />
              </button>
            )}
          </>
        }
        expandable={expandable}
        open={open}
        onToggle={() => setManualOpen((value) => !(value ?? defaultOpen))}
      >
        {hasArgs && (
          <div className="font-mono bg-base-200/60 rounded px-2 py-1 text-xs text-base-content/50">
            <div className="text-[10px] text-base-content/30 mb-0.5">input</div>
            {Object.entries(args!).map(([k, v]) => (
              <div key={k}>
                <span className="text-base-content/40">{k}:</span> {formatArgValue(v)}
              </div>
            ))}
          </div>
        )}
        {hasResult && (
          <div className="font-mono bg-base-200/60 rounded px-2 py-1 max-h-40 overflow-y-auto whitespace-pre-wrap text-xs text-base-content/60">
            {typeof parsed === 'object' ? JSON.stringify(parsed, null, 2) : String(parsed)}
          </div>
        )}
        {cliResult && (
          <TerminalOutputBlock
            result={cliResult}
            isExpanded={open}
            onToggle={() => setManualOpen((value) => !(value ?? defaultOpen))}
            agentId={args?.['agentId'] as string | undefined}
          />
        )}
        {cliSessionSnapshot && <CLIAgentSessionStatusBlock snapshot={cliSessionSnapshot} />}
        {displayedSubAgentFlowResult && <SubAgentFlowResultBlock result={displayedSubAgentFlowResult} />}
        {subagentResult && <SubagentResultBlock key={subagentResult.childSessionId} result={subagentResult} />}
        {imageResult && <ImageResultRenderer data={imageResult} />}
        {raapp && !isAnswered && <RAAppRenderer block={raapp} />}
      </Chip>
      {raapp && isAnswered && (
        <div className="border-l-[3px] border-l-emerald-500/20 pl-3 py-1 my-0.5 text-xs text-base-content/40 italic">
          Interactive app — answer submitted
        </div>
      )}
    </>
  );
}
