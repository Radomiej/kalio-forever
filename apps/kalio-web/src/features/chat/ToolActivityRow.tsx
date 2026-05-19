import { useState } from 'react';
import { Wrench, CheckCircle2, XCircle, Loader2, Clock, ChevronDown, AlertTriangle } from 'lucide-react';
import type { ToolActivity } from '../../store/agentStore';

interface ToolActivityRowProps {
  activity: ToolActivity;
}

function formatMs(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function formatArg(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'string') return value.length > 80 ? value.slice(0, 80) + '…' : value;
  const str = JSON.stringify(value);
  return str.length > 80 ? str.slice(0, 80) + '…' : str;
}

const STATUS_ICON: Record<ToolActivity['status'], React.ReactNode> = {
  awaiting_confirmation: <Clock size={14} className="text-warning animate-pulse" />,
  running:               <Loader2 size={14} className="text-sky-400 animate-spin" />,
  success:               <CheckCircle2 size={14} className="text-success" />,
  error:                 <XCircle size={14} className="text-error" />,
  cancelled:             <XCircle size={14} className="text-base-content/40" />,
  expired:               <AlertTriangle size={14} className="text-warning" />,
};

const STATUS_LABEL: Record<ToolActivity['status'], string> = {
  awaiting_confirmation: 'waiting for confirmation',
  running:               'running',
  success:               'done',
  error:                 'failed',
  cancelled:             'cancelled',
  expired:               'confirmation expired',
};

export function ToolActivityRow({ activity }: ToolActivityRowProps) {
  const [open, setOpen] = useState(false);
  const elapsed =
    activity.finishedAt != null
      ? activity.finishedAt - activity.startedAt
      : null;

  const hasArgs = Object.keys(activity.args).length > 0;
  const hasResult =
    activity.result?.data != null || activity.result?.errorMessage != null;

  return (
    <div
      data-testid="tool-activity-row"
      data-status={activity.status}
      className="flex justify-start"
    >
      <div className="max-w-[75%] rounded-xl border border-base-300 bg-base-200/60 px-3 py-2 text-xs">
        {/* Header row */}
        <div className="flex items-center gap-2">
          <Wrench size={12} className="text-base-content/40 shrink-0" />
          <span className="font-mono font-medium text-sky-400">{activity.toolName}</span>
          <span className="text-base-content/40">{STATUS_LABEL[activity.status]}</span>
          {STATUS_ICON[activity.status]}
          {elapsed != null && (
            <span className="ml-auto text-base-content/30 font-mono">{formatMs(elapsed)}</span>
          )}
          {(hasArgs || hasResult) && (
            <button
              className="ml-1 text-base-content/30 hover:text-base-content/60 transition-colors"
              onClick={() => setOpen((v) => !v)}
              aria-label="Toggle details"
            >
              <ChevronDown
                size={12}
                className={`transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
              />
            </button>
          )}
        </div>

        {/* Expandable details */}
        {open && (
          <div className="mt-2 flex flex-col gap-2 border-t border-base-300/40 pt-2">
            {hasArgs && (
              <div>
                <div className="text-base-content/40 mb-1">Input</div>
                <div className="flex flex-col gap-1">
                  {Object.entries(activity.args).map(([k, v]) => (
                    <div key={k} className="flex gap-2 items-baseline">
                      <span className="text-base-content/50 font-medium shrink-0">{k}</span>
                      <span
                        className="rounded bg-base-300/70 px-1.5 py-0.5 font-mono text-base-content/75 truncate"
                        title={formatArg(v)}
                      >
                        {formatArg(v)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {hasResult && (
              <div>
                <div className="text-base-content/40 mb-1">Output</div>
                <pre className="rounded bg-base-300/50 p-2 font-mono text-base-content/70 whitespace-pre-wrap max-h-40 overflow-y-auto">
                  {activity.result?.errorMessage
                    ? activity.result.errorMessage
                    : typeof activity.result?.data === 'string'
                      ? activity.result.data
                      : JSON.stringify(activity.result?.data, null, 2)}
                </pre>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
