import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HitlRequestService } from '../hitl/hitl-request.service';
import type { StreamContext } from './interfaces/stream-context.interface';
import type { PendingConfirmation } from './tool-confirmation-pending';
import { awaitToolConfirmation, type ToolConfirmationWaitInput } from './tool-confirmation-wait';

vi.mock('./llm-turn-runtime-dispatch', () => ({ detachHostReceiptArgs: (value: unknown) => structuredClone(value) }));

function fixture(timeout?: number) {
  const controller = new AbortController();
  const pending = new Map<string, PendingConfirmation>();
  let row: { id: string; revision: number; status: string } | undefined;
  const cas = (_id: string, revision: number, status: string) => {
    if (!row || row.id !== _id || row.revision !== revision || row.status !== 'pending') return false;
    row.status = status; row.revision++;
    return true;
  };
  const requests = {
    create: vi.fn(async (input: Parameters<HitlRequestService['create']>[0]) => {
      row = { id: input.id!, revision: 1, status: 'pending' };
      return { ...input, ...row, turnId: input.turnId ?? null };
    }),
    resolve: vi.fn(async (id: string, revision: number, status: string, _outcome?: Record<string, unknown>) => cas(id, revision, status)),
  };
  const ctx = { sessionId: 'session', turnId: 'turn', messageId: 'message', runId: 'run', promptMessageId: 'prompt',
    abortSignal: controller.signal, emit: vi.fn(), onResolvedToolDispatch: vi.fn(), registerToolResultReceiptCommit: vi.fn(),
  } as unknown as StreamContext;
  const input: ToolConfirmationWaitInput = {
    callId: 'call', toolName: 'terminal_spawn', args: { command: 'test' }, ctx, pending,
    hitlRequests: requests as unknown as HitlRequestService, hitlNotifications: null, runtimeAudit: null,
    logger: { warn: vi.fn(), error: vi.fn() }, emitConfirmationInvalidated: vi.fn(),
    logConfirmationLifecycle: vi.fn(), logRuntimeConfirmation: vi.fn(),
    ...(timeout !== undefined ? { manualReviewTimeoutMs: timeout } : {}),
  };
  const start = async () => {
    const settled = vi.fn();
    const promise = awaitToolConfirmation(input).then(result => { settled(result); return result; });
    await vi.advanceTimersByTimeAsync(0);
    const current = [...pending.values()][0]!;
    return { promise, settled, current, id: current.payload.requestId };
  };
  const human = async (id: string) => {
    const current = pending.get(id);
    if (!current || !await requests.resolve(id, current.revision!, 'approved')) return false;
    if (pending.get(id) === current) pending.delete(id);
    current.resolve();
    return true;
  };
  return { input, requests, pending, controller, start, human, cas, row: () => row };
}

describe('durable manual review timeout', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

  it('expires at one minute before publishing timeout, and rejects a late human CAS', async () => {
    const f = fixture(60_000), wait = await f.start();
    await vi.advanceTimersByTimeAsync(59_999);
    expect(wait.settled).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(f.requests.resolve).toHaveBeenCalledWith(wait.id, 1, 'expired', { reason: 'human_review_timeout' });
    expect(f.row()?.status).toBe('expired');
    expect(await wait.promise).toEqual({ status: 'timeout', requestId: wait.id });
    expect(f.pending.has(wait.id)).toBe(false);
    expect(f.cas(wait.id, 1, 'approved')).toBe(false);
    expect(f.input.emitConfirmationInvalidated).toHaveBeenCalledWith(wait.current, 'timeout', expect.any(String));
  });

  it('keeps the same pending waiter until the expiry CAS succeeds', async () => {
    const f = fixture(60_000);
    let release!: (value: boolean) => void;
    f.requests.resolve.mockImplementationOnce(() => new Promise<boolean>(resolve => { release = resolve; }));
    const wait = await f.start();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(f.pending.get(wait.id)).toBe(wait.current);
    expect(wait.settled).not.toHaveBeenCalled();
    expect(f.input.emitConfirmationInvalidated).not.toHaveBeenCalled();
    release(f.cas(wait.id, 1, 'expired'));
    expect(await wait.promise).toHaveProperty('status', 'timeout');
  });

  it('leaves a failed expiry CAS to the human winner without triggering timeout', async () => {
    const f = fixture(60_000);
    f.requests.resolve.mockResolvedValueOnce(false);
    const wait = await f.start();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(wait.settled).not.toHaveBeenCalled();
    expect(f.pending.get(wait.id)).toBe(wait.current);
    expect(f.input.emitConfirmationInvalidated).not.toHaveBeenCalled();
    expect(await f.human(wait.id)).toBe(true);
    expect(await wait.promise).toHaveProperty('status', 'approved');
  });

  it('keeps manual review on persistence error and still accepts a human', async () => {
    const f = fixture(60_000);
    f.requests.resolve.mockRejectedValueOnce(new Error('database unavailable'));
    const wait = await f.start();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(wait.settled).not.toHaveBeenCalled();
    expect(f.input.logger.error).toHaveBeenCalled();
    expect(f.pending.get(wait.id)).toBe(wait.current);
    expect(await f.human(wait.id)).toBe(true);
    expect(await wait.promise).toHaveProperty('status', 'approved');
  });

  it('lets human approval win while the timeout CAS is in flight', async () => {
    const f = fixture(60_000);
    let release!: (value: boolean) => void;
    f.requests.resolve.mockImplementationOnce(() => new Promise<boolean>(resolve => { release = resolve; }));
    const wait = await f.start();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await f.human(wait.id)).toBe(true);
    release(f.cas(wait.id, 1, 'expired'));
    await vi.advanceTimersByTimeAsync(0);
    expect(await wait.promise).toHaveProperty('status', 'approved');
    expect(f.input.emitConfirmationInvalidated).not.toHaveBeenCalled();
  });

  it('lets abort win against an in-flight timeout without returning timeout', async () => {
    const f = fixture(60_000);
    let release!: (value: boolean) => void;
    f.requests.resolve.mockImplementationOnce(() => new Promise<boolean>(resolve => { release = resolve; }));
    const wait = await f.start();
    await vi.advanceTimersByTimeAsync(60_000);
    f.controller.abort();
    await vi.advanceTimersByTimeAsync(0);
    release(f.cas(wait.id, 1, 'expired'));
    expect(await wait.promise).toHaveProperty('status', 'rejected');
    expect(f.row()?.status).toBe('cancelled');
    expect(wait.settled).toHaveBeenCalledTimes(1);
    expect(f.input.emitConfirmationInvalidated).not.toHaveBeenCalledWith(wait.current, 'timeout', expect.anything());
  });

  it('does not expire a replacement waiter registered before the timer fires', async () => {
    const f = fixture(60_000), wait = await f.start();
    const replacement = { ...wait.current, resolve: vi.fn(), reject: vi.fn() };
    f.pending.set(wait.id, replacement);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(f.requests.resolve).not.toHaveBeenCalled();
    expect(f.pending.get(wait.id)).toBe(replacement);
    expect(wait.settled).not.toHaveBeenCalled();
    wait.current.reject(); await wait.promise;
  });

  it('does not remove a replacement waiter while the timeout CAS is in flight', async () => {
    const f = fixture(60_000);
    let release!: (value: boolean) => void;
    f.requests.resolve.mockImplementationOnce(() => new Promise<boolean>(resolve => { release = resolve; }));
    const wait = await f.start();
    await vi.advanceTimersByTimeAsync(60_000);
    const replacement = { ...wait.current, resolve: vi.fn(), reject: vi.fn() };
    f.pending.set(wait.id, replacement);
    release(f.cas(wait.id, 1, 'expired'));
    await vi.advanceTimersByTimeAsync(0);
    expect(f.pending.get(wait.id)).toBe(replacement);
    expect(f.input.emitConfirmationInvalidated).not.toHaveBeenCalled();
    expect(wait.settled).not.toHaveBeenCalled();
    wait.current.reject(); await wait.promise;
  });

  it('does not expire a waiter whose pending revision changed', async () => {
    const f = fixture(60_000), wait = await f.start();
    wait.current.revision = 2;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(f.requests.resolve).not.toHaveBeenCalled();
    expect(wait.settled).not.toHaveBeenCalled();
    wait.current.reject(); await wait.promise;
  });

  it('clears the timeout when a human approves before the deadline', async () => {
    const f = fixture(60_000), wait = await f.start();
    expect(await f.human(wait.id)).toBe(true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await wait.promise).toHaveProperty('status', 'approved');
    expect(f.requests.resolve).toHaveBeenCalledTimes(1);
    expect(f.requests.resolve).toHaveBeenCalledWith(wait.id, 1, 'approved');
  });

  it('removes the abort listener after a successful expiry', async () => {
    const f = fixture(60_000);
    const remove = vi.spyOn(f.controller.signal, 'removeEventListener');
    const wait = await f.start();
    await vi.advanceTimersByTimeAsync(60_000);
    await wait.promise;
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
    f.controller.abort();
    await vi.advanceTimersByTimeAsync(0);
    expect(f.requests.resolve).toHaveBeenCalledTimes(1);
  });

  it('uses an explicit positive window for subagents instead of their infinite default', async () => {
    const f = fixture(60_000);
    Object.assign(f.input.ctx, { agentRun: { agentType: 'subagent' } });
    const wait = await f.start();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await wait.promise).toHaveProperty('status', 'timeout');
  });

  it.each([-1, NaN, Infinity, 1.5, 2_147_483_648])('fails closed on an invalid review window: %s', async timeout => {
    const f = fixture(timeout), wait = await f.start();
    expect(wait.current.payload.timeoutMs).toBe(0);
    await vi.advanceTimersByTimeAsync(600_000);
    expect(wait.settled).not.toHaveBeenCalled();
    wait.current.reject(); await wait.promise;
  });

  it.each([undefined, 0])('keeps default and explicit zero infinite (%s)', async timeout => {
    const f = fixture(timeout), wait = await f.start();
    await vi.advanceTimersByTimeAsync(600_000);
    expect(wait.current.payload.timeoutMs).toBe(0);
    expect(f.requests.resolve).not.toHaveBeenCalled();
    expect(await f.human(wait.id)).toBe(true);
    await wait.promise;
  });

  it('forces protected host confirmation to infinite despite a configured timeout', async () => {
    const f = fixture(60_000);
    Object.defineProperty(f.input.ctx, 'hostConfirmationRequirement', {
      value: { kind: 'human_only', toolName: 'terminal_spawn', callId: 'call' },
    });
    const wait = await f.start();
    await vi.advanceTimersByTimeAsync(600_000);
    expect(wait.current.payload.timeoutMs).toBe(0);
    expect(f.requests.resolve).not.toHaveBeenCalled();
    wait.current.reject(); await wait.promise;
  });

  it.each(['missing service', 'missing revision', 'wrong session', 'already approved'])('waits indefinitely when persistence is ineligible: %s', async reason => {
    const f = fixture(60_000);
    if (reason === 'missing service') f.input.hitlRequests = null;
    else f.requests.create.mockImplementationOnce(async input => ({ ...input, id: input.id!, turnId: 'turn',
      sessionId: reason === 'wrong session' ? 'other' : 'session', revision: reason === 'missing revision' ? 0 : 1,
      status: reason === 'already approved' ? 'approved' : 'pending' }));
    const wait = await f.start();
    await vi.advanceTimersByTimeAsync(600_000);
    expect(wait.current.payload.timeoutMs).toBe(0);
    expect(wait.settled).not.toHaveBeenCalled();
    expect(f.requests.resolve).not.toHaveBeenCalled();
    wait.current.reject(); await wait.promise;
  });
});
