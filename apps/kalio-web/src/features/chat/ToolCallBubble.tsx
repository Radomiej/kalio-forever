/**
 * ToolCallBubble â€” unified chip for a single tool call.
 *
 * Architecture: one item per toolCallId, driven by a merged status:
 *   running | awaiting_confirmation | success | error | cancelled
 *
 * While running: spinner + args (no widget).
 * Once tool_result lands in ChatMessage: result shown inline, widget rendered.
 * Once user answers (isAnswered): widget collapses to "answer submitted".
 *
 * Two named exports kept for AgentTurnBubble compatibility:
 *   LiveToolCallBubble   â€” tool still in-flight (ToolActivity, no result yet)
 *   HistoryToolCallBubble â€” tool finished (tool_result ChatMessage)
 */
import { useEffect, useState, useMemo } from 'react';
import { CheckCircle2, XCircle, Loader2, ExternalLink, AlertTriangle } from 'lucide-react';
import type { AgentFlowRunSnapshot, SubAgentFlowResult } from '@kalio/types';
import type { ToolActivity } from '../../store/agentStore';
import { useAgentStore } from '../../store/agentStore';
import { apiClient } from '../../services/apiClient';

import { RAAppRenderer } from '../raapp/RAAppRenderer';
import { TerminalOutputBlock } from './TerminalOutputBlock';
import { LiveCLIAgentBlock } from './LiveCLIAgentBlock';
import { ImageResultRenderer } from './ImageResultRenderer';
import { WebSearchResultRenderer } from './WebSearchResultRenderer';
import {
  extractCLIAgentResult,
  extractCLIAgentSessionSnapshot,
  extractImageResult,
  extractRAAppBlock,
  extractSubAgentFlowResult,
  extractSubagentResult,
  extractWebSearchResult,
} from './ToolCallBubble.parsers';
import { Chip, ConfirmationInlineBubble, formatArgValue } from './ToolCallBubble.Chrome';
import { SubagentResultBlock, CLIAgentSessionStatusBlock, SubAgentFlowResultBlock } from './ToolCallBubble.ResultBlocks';
import { getToolTargetLabel } from './toolTargetLabel';
import { CLIChildConversationCard } from './CLIChildConversationCard';
import { isCliChildDelegationTool } from './cliChildProjection.model';
import { useSessionStore } from '../../store/sessionStore';

export { extractRAAppBlock } from './ToolCallBubble.parsers';

const DURABLE_CLI_AGENT_TOOLS = new Set([
  'spawn_cli_agent',
  'message_cli_agent',
  'get_cli_agent_status',
  'stop_cli_agent',
]);


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

export function LiveToolCallBubble({ activity }: { activity: ToolActivity }) {
  const [manualOpen, setManualOpen] = useState<boolean | null>(null);
  const elapsed = activity.finishedAt != null ? activity.finishedAt - activity.startedAt : null;
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const cliProjection = useAgentStore((s) => (
    Object.values(s.cliChildProjections).find((item) => item.parentCallId === activity.callId)
  ));
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
  const showCliChildCard = isCliChildDelegationTool(activity.toolName)
    || (cliSessionSnapshot != null && activity.toolName === 'spawn_cli_agent');
  const parentSessionId = activity.sessionId
    ?? cliSessionSnapshot?.parentSessionId
    ?? activeSessionId
    ?? '';
  const childSessionId = cliSessionSnapshot?.childSessionId
    ?? cliProjection?.childSessionId
    ?? (activity.result?.data != null ? extractCLIAgentResult(activity.result.data)?.childSessionId : undefined);
  const hasNonRaappResult = activity.result?.data != null
    && extractRAAppBlock(activity.result.data) == null
    && extractImageResult(activity.result.data) == null
    && cliSessionSnapshot == null;
  const defaultOpen = showCliChildCard
    ? false
    : descendantActivities.length > 0
      || isRunningCliAgent
      || cliSessionSnapshot != null
      || activity.status === 'cancelled'
      || activity.status === 'expired'
      || activity.status === 'error';
  const open = manualOpen ?? defaultOpen;
  const expandable = hasArgs || hasNonRaappResult || isRunningCliAgent || descendantActivities.length > 0 || cliSessionSnapshot != null;
  const imageResult = activity.result?.data != null ? extractImageResult(activity.result.data) : null;

  return (
    <div className="space-y-2">
      {showCliChildCard && parentSessionId && (
        <CLIChildConversationCard
          toolName={activity.toolName}
          parentSessionId={parentSessionId}
          parentCallId={activity.callId}
          activity={activity}
          resultData={activity.result?.data}
          childSessionId={childSessionId}
          onInspect={() => setManualOpen(true)}
        />
      )}
      {(!showCliChildCard || manualOpen) && (
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
      {!showCliChildCard && isRunningCliAgent && (
        <LiveCLIAgentBlock
          callId={activity.callId}
          agentId={(activity.args['agentId'] as string | undefined) ?? 'copilot'}
        />
      )}
      {!showCliChildCard && cliSessionSnapshot && <CLIAgentSessionStatusBlock snapshot={cliSessionSnapshot} />}
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
      )}
    </div>
  );
}

// â”€â”€â”€ History chip â€” completed tool_result from ChatMessage â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Widget renders inline here, in its chronological position within the agent turn.
// Collapses to "answer submitted" when user responds (isAnswered=true).

export function HistoryToolCallBubble({
  toolName,
  content,
  isAnswered,
  args,
  callId = '',
  parentSessionId: parentSessionIdProp,
  defaultOpenOverride,
}: {
  toolName: string;
  content: string;
  isAnswered?: boolean;
  args?: Record<string, unknown>;
  callId?: string;
  parentSessionId?: string;
  defaultOpenOverride?: boolean;
}) {
  const setCanvasOpen = useAgentStore((s) => s.setCanvasOpen);
  const setCanvasFocus = useAgentStore((s) => s.setCanvasFocus);
  const isSubagent = toolName === 'run_subagent';
  const isCliAgent = toolName === 'run_cli_agent';
  const isSubAgentFlow = toolName === 'run_sub_agentflow';
  const isDurableCliAgent = DURABLE_CLI_AGENT_TOOLS.has(toolName);
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const showCliChildCard = isCliChildDelegationTool(toolName);

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    parsed = content;
  }

  const raapp = extractRAAppBlock(parsed);
  const cliResult = isCliAgent ? extractCLIAgentResult(parsed) : null;
  const cliSessionSnapshot = isDurableCliAgent ? extractCLIAgentSessionSnapshot(parsed) : null;
  const historyChildSessionId = cliSessionSnapshot?.childSessionId ?? cliResult?.childSessionId;
  const historyParentSessionId = parentSessionIdProp ?? cliSessionSnapshot?.parentSessionId ?? activeSessionId ?? '';
  const showsCliChildCard = showCliChildCard && Boolean(historyParentSessionId && (callId || historyChildSessionId));
  const imageResult = extractImageResult(parsed);
  const webSearchResult = toolName === 'web_search' ? extractWebSearchResult(parsed) : null;
  const subagentResult = isSubagent ? extractSubagentResult(parsed) : null;
  const subAgentFlowResult = isSubAgentFlow ? extractSubAgentFlowResult(parsed) : null;
  const [refreshedSubAgentFlowResult, setRefreshedSubAgentFlowResult] = useState<SubAgentFlowResult | null>(null);
  const displayedSubAgentFlowResult = refreshedSubAgentFlowResult ?? subAgentFlowResult;
  const hasArgs = args != null && Object.keys(args).length > 0;
  const inferredDefaultOpen = showCliChildCard
    ? false
    : (raapp != null && !isAnswered) || cliResult != null || cliSessionSnapshot != null || imageResult != null || webSearchResult != null || subagentResult != null || displayedSubAgentFlowResult != null;
  const defaultOpen = defaultOpenOverride ?? inferredDefaultOpen;
  const [manualOpen, setManualOpen] = useState<boolean | null>(null);
  const open = isAnswered ? false : (manualOpen ?? defaultOpen);

  const hasResult = !raapp && !cliResult && !cliSessionSnapshot && !imageResult && !webSearchResult && !subagentResult && !displayedSubAgentFlowResult && content.length > 0;
  const expandable = hasArgs || hasResult || (raapp != null && !isAnswered) || cliResult != null || cliSessionSnapshot != null || imageResult != null || webSearchResult != null || subagentResult != null || displayedSubAgentFlowResult != null;
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
      {showsCliChildCard && (
        <CLIChildConversationCard
          toolName={toolName}
          parentSessionId={historyParentSessionId}
          parentCallId={callId || `history-${historyChildSessionId ?? toolName}`}
          resultData={parsed}
          childSessionId={historyChildSessionId}
          onInspect={() => setManualOpen(true)}
        />
      )}
      {(!showsCliChildCard || manualOpen) && (
      <Chip
        icon={<CheckCircle2 size={12} className="text-success shrink-0" />}
        toolName={toolName}
        targetLabel={getToolTargetLabel(toolName, args)}
        badge={
          <>
            {isAnswered && <span className="text-[10px] font-mono text-base-content/40 bg-base-200/60 rounded px-1">â†© answered</span>}
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
        {!showsCliChildCard && cliResult && (
          <TerminalOutputBlock
            result={cliResult}
            isExpanded={open}
            onToggle={() => setManualOpen((value) => !(value ?? defaultOpen))}
            agentId={args?.['agentId'] as string | undefined}
          />
        )}
        {!showsCliChildCard && cliSessionSnapshot && <CLIAgentSessionStatusBlock snapshot={cliSessionSnapshot} />}
        {displayedSubAgentFlowResult && <SubAgentFlowResultBlock result={displayedSubAgentFlowResult} />}
        {subagentResult && <SubagentResultBlock key={subagentResult.childSessionId} result={subagentResult} />}
        {imageResult && <ImageResultRenderer data={imageResult} />}
        {webSearchResult && <WebSearchResultRenderer data={webSearchResult} />}
        {raapp && !isAnswered && <RAAppRenderer block={raapp} />}
      </Chip>
      )}
      {raapp && isAnswered && (
        <div className="border-l-[3px] border-l-emerald-500/20 pl-3 py-1 my-0.5 text-xs text-base-content/40 italic">
          Interactive app â€” answer submitted
        </div>
      )}
    </>
  );
}
