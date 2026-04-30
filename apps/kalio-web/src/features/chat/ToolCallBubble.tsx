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
import { useState, useEffect } from 'react';
import { CheckCircle2, XCircle, Loader2, Clock, ChevronDown } from 'lucide-react';
import type { ToolActivity } from '../../store/agentStore';
import type { RAAppBlock, RaAppPendingApproval } from '@kalio/types';
import { RAAppRenderer } from '../raapp/RAAppRenderer';

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

export function extractRAAppBlock(data: unknown): RAAppBlock | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  if ((d['type'] === 'html' || d['type'] === 'gui') && typeof d['content'] === 'string') {
    return {
      type: d['type'] as 'html' | 'gui',
      mode: (d['mode'] as 'display' | 'interactive') ?? 'display',
      content: (d['renderedContent'] as string | undefined) ?? (d['content'] as string),
      pendingApprovals: (d['pendingApprovals'] as RaAppPendingApproval[] | undefined) ?? [],
    };
  }
  return null;
}

// ─── Chip chrome ─────────────────────────────────────────────────────────────

function Chip({
  icon,
  toolName,
  badge,
  elapsed,
  expandable,
  open,
  onToggle,
  children,
}: {
  icon: React.ReactNode;
  toolName: string;
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
      className="border-l-[3px] border-l-emerald-500/40 pl-3 py-1 my-1"
    >
      <div data-testid="tool-call-chip" className="flex items-center gap-1.5 flex-wrap">
        {icon}
        <span className="font-mono text-xs text-sky-400">{toolName}</span>
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

// ─── Live chip — running/awaiting/error from ToolActivity ─────────────────────
// Widget is NEVER rendered here. It appears in HistoryToolCallBubble once the
// tool_result ChatMessage lands in the session store.

export function LiveToolCallBubble({ activity }: { activity: ToolActivity }) {
  const [open, setOpen] = useState(false);
  const elapsed = activity.finishedAt != null ? activity.finishedAt - activity.startedAt : null;

  const icon =
    activity.status === 'running' ? (
      <Loader2 size={12} className="text-sky-400 animate-spin shrink-0" />
    ) : activity.status === 'awaiting_confirmation' ? (
      <Clock size={12} className="text-warning animate-pulse shrink-0" />
    ) : activity.status === 'success' ? (
      <CheckCircle2 size={12} className="text-success shrink-0" />
    ) : (
      <XCircle size={12} className={activity.status === 'cancelled' ? 'text-base-content/40 shrink-0' : 'text-error shrink-0'} />
    );

  const hasArgs = Object.keys(activity.args).length > 0;
  const hasNonRaappResult = activity.result?.data != null && extractRAAppBlock(activity.result.data) == null;
  const expandable = hasArgs || hasNonRaappResult;

  return (
    <Chip
      icon={icon}
      toolName={activity.toolName}
      elapsed={elapsed}
      expandable={expandable}
      open={open}
      onToggle={() => setOpen((v) => !v)}
    >
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
}: {
  toolName: string;
  content: string;
  isAnswered?: boolean;
  args?: Record<string, unknown>;
}) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    parsed = content;
  }

  const raapp = extractRAAppBlock(parsed);
  const hasArgs = args != null && Object.keys(args).length > 0;
  const [open, setOpen] = useState(() => raapp != null && !isAnswered);
  useEffect(() => {
    if (isAnswered) setOpen(false);
  }, [isAnswered]);

  const hasResult = !raapp && content.length > 0;
  const expandable = hasArgs || hasResult || (raapp != null && !isAnswered);

  return (
    <>
      <Chip
        icon={<CheckCircle2 size={12} className="text-success shrink-0" />}
        toolName={toolName}
        badge={isAnswered ? <span className="text-[10px] font-mono text-base-content/40 bg-base-200/60 rounded px-1">↩ answered</span> : undefined}
        expandable={expandable}
        open={open}
        onToggle={() => setOpen((v) => !v)}
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
