import { AlertTriangle, CheckCircle2, Circle, Loader2, XCircle } from 'lucide-react';
import type { SessionRuntimeState } from './sessionTreeDisplay';

const RUNTIME_LABELS: Record<NonNullable<SessionRuntimeState>, string> = {
  pending: 'Pending',
  running: 'Running',
  waiting: 'Waiting',
  done: 'Completed',
  error: 'Failed',
  stopped: 'Stopped',
};

export function SessionRuntimeStatusIcon({
  sessionId,
  state,
}: {
  sessionId: string;
  state: SessionRuntimeState | null;
}) {
  if (!state) {
    return null;
  }

  const label = RUNTIME_LABELS[state];
  if (state === 'waiting') {
    return (
      <AlertTriangle
        size={10}
        className="text-warning shrink-0"
        aria-label={label}
        data-testid={`session-pending-confirmation-${sessionId}`}
      >
        <title>{label}</title>
      </AlertTriangle>
    );
  }
  if (state === 'pending') {
    return (
      <Circle
        size={10}
        className="shrink-0 text-base-content/40"
        aria-label={label}
        data-testid={`session-pending-${sessionId}`}
      >
        <title>{label}</title>
      </Circle>
    );
  }
  if (state === 'running') {
    return (
      <Loader2
        size={10}
        className="shrink-0 animate-spin text-sky-300"
        aria-label={label}
        data-testid={`session-running-${sessionId}`}
      >
        <title>{label}</title>
      </Loader2>
    );
  }
  if (state === 'done') {
    return (
      <CheckCircle2
        size={10}
        className="shrink-0 text-emerald-300"
        aria-label={label}
        data-testid={`session-done-${sessionId}`}
      >
        <title>{label}</title>
      </CheckCircle2>
    );
  }

  return (
    <XCircle
      size={10}
      className={`shrink-0 ${state === 'error' ? 'text-rose-300' : 'text-base-content/45'}`}
      aria-label={label}
      data-testid={state === 'error' ? `session-error-${sessionId}` : `session-stopped-${sessionId}`}
    >
      <title>{label}</title>
    </XCircle>
  );
}
