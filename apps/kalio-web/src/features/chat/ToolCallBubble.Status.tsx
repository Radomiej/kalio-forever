import { AlertTriangle, CheckCircle2, Loader2, XCircle } from 'lucide-react';
import type { ToolActivity } from '../../store/agentStore';
import { extractPersistedToolResultMeta } from './ToolCallBubble.parsers';

type Status = ToolActivity['status'] | 'denied' | 'unavailable';
export interface ToolCallStatus {
  status: Status;
  errorMessage?: string;
}

function outcome(status: Status, errorCode?: string, errorMessage?: string): ToolCallStatus {
  const denied = status === 'error' && (errorCode === 'ACCESS_DENIED' || /^ACCESS_DENIED\b/.test(errorMessage ?? ''));
  return { status: denied ? 'denied' : status, errorMessage };
}

export function liveToolCallStatus(activity: ToolActivity): ToolCallStatus {
  return outcome(activity.status, activity.result?.errorCode, activity.result?.errorMessage);
}

export function historyToolCallStatus(parsed: unknown, activity?: ToolActivity): ToolCallStatus {
  const meta = extractPersistedToolResultMeta(parsed);
  if (meta) return outcome(meta.status, meta.errorCode, meta.errorMessage);
  if (parsed && typeof parsed === 'object') {
    const record = parsed as Record<string, unknown>;
    if ((record['toolResultStatus'] ?? record['status']) === 'denied') {
      return { status: 'denied', errorMessage: typeof record['errorMessage'] === 'string' ? record['errorMessage'] : undefined };
    }
  }
  // The live result can arrive before a ChatMessage exists. Never replace an explicit
  // terminal outcome with an empty-content heuristic; after F5 the durable envelope wins.
  if (activity && ['error', 'cancelled', 'expired', 'success'].includes(activity.status)) {
    return liveToolCallStatus(activity);
  }
  return { status: parsed == null || (typeof parsed === 'string' && !parsed.trim()) ? 'unavailable' : 'success' };
}

export function toolCallStatusDetails(value: ToolCallStatus): string | undefined {
  if (value.errorMessage) return value.errorMessage;
  switch (value.status) {
    case 'denied': return 'Tool call was denied.';
    case 'error': return 'Tool call failed.';
    case 'cancelled': return 'Tool call was cancelled before it completed.';
    case 'expired': return 'Confirmation timed out before the tool could run.';
    default: return undefined;
  }
}

export function ToolCallStatusIcon({ status }: ToolCallStatus) {
  if (status === 'running') return <Loader2 size={12} className="text-sky-400 animate-spin shrink-0" />;
  if (status === 'success') return <CheckCircle2 size={12} className="text-success shrink-0" />;
  if (status === 'unavailable' || status === 'expired') return <AlertTriangle size={12} className="text-warning shrink-0" />;
  return <XCircle size={12} className={status === 'cancelled' ? 'text-base-content/40 shrink-0' : 'text-error shrink-0'} />;
}

export function ToolCallStatusBadge({ status }: ToolCallStatus) {
  if (status === 'success' || status === 'running' || status === 'awaiting_confirmation') return null;
  const label = status === 'error' ? 'failed' : status === 'expired' ? 'confirmation expired' : status === 'unavailable' ? 'result unavailable' : status;
  const color = status === 'unavailable' || status === 'expired'
    ? 'text-warning/80 bg-warning/10'
    : status === 'cancelled' ? 'text-base-content/55 bg-base-200/70' : 'text-error/80 bg-error/10';
  return <span className={`text-[10px] font-mono rounded px-1 ${color}`}>{label}</span>;
}

export function ToolCallStatusDetails({ value }: { value: ToolCallStatus }) {
  const details = toolCallStatusDetails(value);
  if (!details) return null;
  const color = value.status === 'cancelled' ? 'text-base-content/50' : value.status === 'expired' ? 'text-warning/80' : 'text-error';
  return <div className={`text-xs ${color}`}>{details}</div>;
}
