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

/** Own only this active turn. Guarding is independent of onTurnStart, whose
 * failures must not strand an active entry or abort listener. */
export async function runGuardedDevinPrompt(connection: ClientConnection, session: { active?: ActiveDevinTurn },
  sessionId: string, prompt: string, input: DevinAcpPromptInput, check?: ExecutionCurrentCheck,
): Promise<StopReason> {
  check?.();
  if (input.signal?.aborted) return 'cancelled';
  let rejectConnection!: (error: Error) => void;
  const connectionFailure = new Promise<never>((_, reject) => { rejectConnection = reject; });
  const active: ActiveDevinTurn = { ...input, rejectConnection };
  const abortHandler = (): void => {
    void connection.agent.notify(methods.agent.session.cancel, { sessionId }).catch(() => undefined);
  };
  let releaseTurn: (() => void) | undefined;
  let failed = false;
  let failure: unknown;
  let outcome!: StopReason;
  session.active = active;
  try {
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
    try { releaseTurn?.(); } catch (error) { if (!failed) { failed = true; failure = error; } }
    finally {
      input.signal?.removeEventListener('abort', abortHandler);
      if (session.active === active) session.active = undefined;
    }
  }
  if (failed) throw failure;
  return outcome;
}
