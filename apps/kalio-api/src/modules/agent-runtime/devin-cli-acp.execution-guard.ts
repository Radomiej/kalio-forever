import { methods, type ClientConnection, type PromptRequest, type StopReason } from '@agentclientprotocol/sdk';
import { types } from 'node:util';
import type { DevinAcpPromptInput } from './devin-cli-acp.host';

export type ExecutionCurrentCheck = () => void;
const unavailable = (): never => { throw new Error('EXECUTION_CURRENT_UNAVAILABLE'); };

/** Captures one callback/signal before awaits. Success is a point-in-time check,
 * never a permission or lease. Do not inspect/call arbitrary thenable methods. */
export function captureExecutionCurrent(raw: unknown, signal?: AbortSignal): ExecutionCurrentCheck | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== 'function' || types.isAsyncFunction(raw)) return unavailable();
  const callback = raw;
  return () => {
    if (signal?.aborted) return unavailable();
    let result: unknown;
    try { result = callback(); } catch { return unavailable(); }
    if (result !== undefined) {
      // Quarantine a native rejected Promise without awaiting or adopting it.
      // Non-native thenables remain untouched and rejected as a bad contract.
      if (types.isPromise(result)) {
        try { void Promise.prototype.then.call(result, undefined, () => undefined); } catch { return unavailable(); }
      }
      return unavailable();
    }
    if (signal?.aborted) return unavailable();
  };
}

export async function guardedAcpRequest<T>(check: ExecutionCurrentCheck | undefined, request: () => Promise<T>): Promise<T> {
  check?.();
  const result = await request();
  check?.();
  return result;
}

export interface ActiveDevinTurn extends DevinAcpPromptInput { rejectConnection(error: Error): void }

export interface DevinAcpIdleLimits {
  /** No ACP update while nothing is pending. 0 disables the watchdog. */
  idleMs: number;
  /** No ACP update while a tool call is in progress (bridge HITL approvals can be slow). */
  toolMs: number;
}

const DEFAULT_IDLE_MS = 5 * 60_000;
const DEFAULT_TOOL_MS = 30 * 60_000;

export function resolveDevinAcpIdleLimits(env: NodeJS.ProcessEnv = process.env): DevinAcpIdleLimits {
  const read = (name: string, fallback: number): number => {
    const value = Number(env[name]);
    return Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;
  };
  return { idleMs: read('DEVIN_ACP_IDLE_TIMEOUT_MS', DEFAULT_IDLE_MS), toolMs: read('DEVIN_ACP_TOOL_IDLE_TIMEOUT_MS', DEFAULT_TOOL_MS) };
}

export class DevinAcpIdleTimeoutError extends Error {
  readonly code = 'LLM_TIMEOUT';
  constructor(readonly idleMs: number, readonly toolInProgress: boolean) {
    super(`DEVIN_ACP_IDLE_TIMEOUT: Devin sent no update for ${Math.round(idleMs / 1000)}s${toolInProgress ? ' while a tool call was in progress' : ''}; the turn was cancelled. Send a follow-up message to retry.`);
    this.name = 'DevinAcpIdleTimeoutError';
  }
}

/** Own only this active turn. Guarding is independent of onTurnStart, whose
 * failures must not strand an active entry or abort listener. */
export async function runGuardedDevinPrompt(connection: ClientConnection, session: { active?: ActiveDevinTurn },
  sessionId: string, prompt: string, input: DevinAcpPromptInput, check?: ExecutionCurrentCheck,
  limits: DevinAcpIdleLimits = resolveDevinAcpIdleLimits(),
): Promise<StopReason> {
  check?.();
  if (input.signal?.aborted) return 'cancelled';
  let rejectConnection!: (error: Error) => void;
  const connectionFailure = new Promise<never>((_, reject) => { rejectConnection = reject; });
  const abortHandler = (): void => {
    void connection.agent.notify(methods.agent.session.cancel, { sessionId }).catch(() => undefined);
  };
  // Idle watchdog: any ACP update re-arms it; it is paused while Kalio waits for a human permission decision.
  const toolsInProgress = new Set<string>();
  let pendingPermissions = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const arm = (): void => {
    if (timer) clearTimeout(timer);
    timer = undefined;
    const ms = pendingPermissions > 0 ? 0 : toolsInProgress.size > 0 ? limits.toolMs : limits.idleMs;
    if (ms <= 0) return;
    timer = setTimeout(() => {
      abortHandler();
      rejectConnection(new DevinAcpIdleTimeoutError(ms, toolsInProgress.size > 0));
    }, ms);
    timer.unref?.();
  };
  const active: ActiveDevinTurn = {
    ...input,
    rejectConnection,
    onText: (text) => { arm(); input.onText(text); },
    onThought: (text) => { arm(); input.onThought(text); },
    onToolActivity: (activity) => {
      if (activity.status === 'completed' || activity.status === 'failed') toolsInProgress.delete(activity.toolCallId);
      else if (activity.status === 'in_progress' || activity.status === 'pending') toolsInProgress.add(activity.toolCallId);
      arm();
      input.onToolActivity?.(activity);
    },
    onPermission: async (request) => {
      pendingPermissions += 1;
      arm();
      try { return await input.onPermission(request); }
      finally { pendingPermissions -= 1; arm(); }
    },
  };
  let releaseTurn: (() => void) | undefined;
  let failed = false;
  let failure: unknown;
  let outcome!: StopReason;
  session.active = active;
  try {
    arm();
    releaseTurn = input.onTurnStart?.() || undefined;
    input.signal?.addEventListener('abort', abortHandler, { once: true });
    const blocks: PromptRequest['prompt'] = [{ type: 'text', text: prompt }, ...(input.images ?? [])];
    const response = await Promise.race([
      guardedAcpRequest(check, () => connection.agent.request(methods.agent.session.prompt,
        { sessionId, prompt: blocks }, input.signal ? { cancellationSignal: input.signal } : undefined)),
      connectionFailure,
    ]);
    check?.();
    outcome = response.stopReason;
  } catch (error) {
    if (input.signal?.aborted) outcome = 'cancelled';
    else { failed = true; failure = error instanceof Error ? error : new Error('Devin ACP prompt failed.'); }
  } finally {
    if (timer) clearTimeout(timer);
    try { releaseTurn?.(); } catch (error) { if (!failed) { failed = true; failure = error; } }
    finally {
      input.signal?.removeEventListener('abort', abortHandler);
      if (session.active === active) session.active = undefined;
    }
  }
  if (failed) throw failure;
  return outcome;
}
