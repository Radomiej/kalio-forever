import { createWorkflowError } from '../../common/utils/workflow-error.util';
import type { BeginManualToolWait } from './interfaces/stream-context.interface';

/** Per-execution monotonic clock. Manual scopes exclude their union, not CPU work. */
export function createSubagentExecutionBudget(input: {
  timeoutMs: number;
  signal: AbortSignal;
  isCurrent: () => boolean;
  onExpired: (error: Error) => void;
}) {
  let remaining = input.timeoutMs;
  let chargedAt: number | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timerRevision = 0;
  let started = false;
  let disposed = false;
  let iterationPaused = false;
  let failure: Error | undefined;
  const waits = new Map<string, () => void>();
  const released = new Set<string>();
  let resolveExpiration!: (error: Error) => void;
  // Resolving the failure avoids unhandled rejection during pre-loop preparation.
  // The runtime converts it to its existing timeout rejection inside Promise.race.
  const expiration = new Promise<Error>(resolve => { resolveExpiration = resolve; });
  const clearTimer = () => {
    timerRevision++;
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  const account = () => {
    if (chargedAt !== undefined) remaining -= Math.max(0, performance.now() - chargedAt);
    chargedAt = undefined;
    clearTimer();
  };
  const dispose = () => {
    disposed = true;
    chargedAt = undefined;
    clearTimer();
    waits.clear();
    input.signal.removeEventListener('abort', dispose);
  };
  const current = () => {
    if (disposed || failure) return false;
    if (input.signal.aborted || !input.isCurrent()) { dispose(); return false; }
    return true;
  };
  const expire = () => {
    if (!current()) return;
    failure = createWorkflowError('SUBAGENT_TIMEOUT', `Sub-agent timed out after ${input.timeoutMs}ms`, {
      source: 'subagent-runtime',
    });
    dispose();
    input.onExpired(failure);
    resolveExpiration(failure);
  };
  const arm = () => {
    if (!started || !current() || iterationPaused || waits.size > 0) return;
    if (remaining <= 0) { expire(); return; }
    chargedAt = performance.now();
    const revision = ++timerRevision;
    timer = setTimeout(() => {
      if (revision !== timerRevision || !current()) return;
      account();
      if (remaining <= 0) expire(); else arm();
    }, Math.ceil(remaining));
  };
  const beginManualToolWait: BeginManualToolWait = requestId => {
    if (!current()) {
      if (failure) throw failure;
      throw new Error('Sub-agent execution is no longer current.');
    }
    const prior = waits.get(requestId);
    if (prior) return prior;
    if (!requestId.trim() || released.has(requestId)) throw new Error('Invalid or settled manual wait.');
    account();
    if (remaining <= 0) { expire(); throw failure; }
    let settled = false;
    const release = () => {
      if (settled) return;
      settled = true;
      if (waits.get(requestId) !== release) return;
      waits.delete(requestId);
      released.add(requestId);
      if (waits.size === 0) arm();
    };
    waits.set(requestId, release);
    return release;
  };
  input.signal.addEventListener('abort', dispose, { once: true });
  return {
    expiration,
    start() { if (!started) { started = true; arm(); } },
    beginManualToolWait,
    pauseForIterationApproval() {
      if (!current()) return;
      account();
      if (remaining <= 0) { expire(); return; }
      iterationPaused = true;
    },
    resetAfterIterationGrant() {
      if (!current() || !iterationPaused) return;
      iterationPaused = false;
      remaining = input.timeoutMs;
      arm(); // Existing manual tokens survive an explicit iteration grant.
    },
    dispose,
  };
}
