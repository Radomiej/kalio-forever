import { useState, useEffect } from 'react';
import { CheckCircle2, XCircle, Loader2, Clock, ChevronDown } from 'lucide-react';
import type { ToolActivity } from '../../store/agentStore';
import type { RAAppBlock } from '@kalio/types';
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
    };
  }
  return null;
}

// ─── Result preview ───────────────────────────────────────────────────────────

function ResultPreview({ data }: { data: unknown }) {
  const raapp = extractRAAppBlock(data);
  if (raapp) return <RAAppRenderer block={raapp} />;

  const str = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  return (
    <div className="font-mono bg-base-200/60 rounded px-2 py-1 max-h-40 overflow-y-auto whitespace-pre-wrap text-xs text-base-content/60">
      {str.length > 500 ? str.slice(0, 500) + '…' : str}
    </div>
  );
}

// ─── Shared chip chrome ───────────────────────────────────────────────────────

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
      <div className="flex items-center gap-1.5 flex-wrap">
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

// ─── Live chip (from ToolActivity in agentStore) ──────────────────────────────

export function LiveToolCallBubble({ activity }: { activity: ToolActivity }) {
  const raapp = activity.result?.data != null ? extractRAAppBlock(activity.result.data) : null;
  // Auto-expand when there's a RA-App widget result
  const [open, setOpen] = useState(() => raapp != null);
  // If result arrives after mount (streaming), auto-open
  useEffect(() => {
    if (raapp != null) setOpen(true);
  }, [raapp]);
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
  const hasResult = !raapp && (activity.result?.data != null || activity.result?.errorMessage != null);
  const expandable = hasArgs || hasResult || raapp != null;

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
      {hasResult && activity.result?.data != null && <ResultPreview data={activity.result.data} />}
      {activity.result?.errorMessage && (
        <div className="text-xs text-error">{activity.result.errorMessage}</div>
      )}
      {raapp && <RAAppRenderer block={raapp} />}
    </Chip>
  );
}

// ─── History chip (from tool_result ChatMessage) ──────────────────────────────

export function HistoryToolCallBubble({
  toolName,
  content,
  isAnswered,
}: {
  toolName: string;
  content: string;
  isAnswered?: boolean;
}) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    parsed = content;
  }

  const raapp = extractRAAppBlock(parsed);
  // Expand by default only when there's an active (unanswered) RA-App widget
  const [open, setOpen] = useState(() => raapp != null && !isAnswered);
  // Auto-collapse widget when user answers
  useEffect(() => {
    if (isAnswered) setOpen(false);
  }, [isAnswered]);
  const hasResult = !raapp && content.length > 0;
  // Expandable if there's non-raapp result to show, OR if raapp is not yet answered
  const expandable = hasResult || (raapp != null && !isAnswered);

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
