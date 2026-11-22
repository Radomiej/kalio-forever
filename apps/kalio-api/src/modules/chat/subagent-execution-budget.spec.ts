import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSubagentExecutionBudget } from './subagent-execution-budget';

function fixture(timeoutMs = 50) {
  vi.useFakeTimers();
  const controller = new AbortController();
  let current = true;
  const expired = vi.fn((error: Error) => controller.abort(error));
  const budget = createSubagentExecutionBudget({ timeoutMs, signal: controller.signal,
    isCurrent: () => current, onExpired: expired });
  budget.start();
  return { budget, expired, controller, stale: () => { current = false; } };
}

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe('Subagent remaining execution clock', () => {
  it('does not reset ordinary execution without an actual pending iteration grant', async () => {
    const f = fixture(); await vi.advanceTimersByTimeAsync(20);
    f.budget.resetAfterIterationGrant();
    await vi.advanceTimersByTimeAsync(29); expect(f.expired).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1); expect(f.expired).toHaveBeenCalledTimes(1);
  });
  it('accounts for the observed long wait without granting fresh execution time', async () => {
    const f = fixture(300_000);
    await vi.advanceTimersByTimeAsync(144_364);
    const release = f.budget.beginManualToolWait('approval');
    await vi.advanceTimersByTimeAsync(900_000);
    expect(f.expired).not.toHaveBeenCalled();
    release();
    await vi.advanceTimersByTimeAsync(155_635); expect(f.expired).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(await f.budget.expiration).toMatchObject({ code: 'SUBAGENT_TIMEOUT', source: 'subagent-runtime' });
    expect(f.controller.signal.reason).toMatchObject({ code: 'SUBAGENT_TIMEOUT' });
  });

  it('unions overlapping scopes and deduplicates acquisition/release by request identity', async () => {
    const f = fixture(); await vi.advanceTimersByTimeAsync(20);
    const a = f.budget.beginManualToolWait('a');
    expect(f.budget.beginManualToolWait('a')).toBe(a);
    await vi.advanceTimersByTimeAsync(200);
    const b = f.budget.beginManualToolWait('b');
    a(); a();
    await vi.advanceTimersByTimeAsync(200); expect(f.expired).not.toHaveBeenCalled();
    b(); b();
    expect(() => f.budget.beginManualToolWait('a')).toThrow('settled');
    await vi.advanceTimersByTimeAsync(29); expect(f.expired).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1); expect(f.expired).toHaveBeenCalledTimes(1);
  });

  it('expires before pause even if the timer callback has not had a chance to fire', async () => {
    const f = fixture();
    vi.spyOn(performance, 'now').mockReturnValue(performance.now() + 50);
    expect(() => f.budget.beginManualToolWait('too-late')).toThrow(expect.objectContaining({ code: 'SUBAGENT_TIMEOUT' }));
    expect(await f.budget.expiration).toMatchObject({ code: 'SUBAGENT_TIMEOUT' });
    expect(f.expired).toHaveBeenCalledTimes(1);
  });

  it.each(['abort', 'dispose', 'stale'] as const)('cannot rearm a released scope after %s', async mode => {
    const f = fixture(); const release = f.budget.beginManualToolWait('a');
    if (mode === 'abort') f.controller.abort();
    if (mode === 'dispose') f.budget.dispose();
    if (mode === 'stale') f.stale();
    release(); f.budget.resetAfterIterationGrant(); f.budget.start();
    await vi.advanceTimersByTimeAsync(500);
    expect(f.expired).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
    expect(() => f.budget.beginManualToolWait('late')).toThrow();
  });

  it('ignores an old timer generation without invalidating the execution owner or manual token', async () => {
    const f = fixture();
    const timers = vi.spyOn(globalThis, 'setTimeout');
    await vi.advanceTimersByTimeAsync(10);
    const release = f.budget.beginManualToolWait('a'); release();
    const old = timers.mock.calls[0]![0] as () => void;
    const next = f.budget.beginManualToolWait('b');
    old();
    await vi.advanceTimersByTimeAsync(100); expect(f.expired).not.toHaveBeenCalled();
    next();
    await vi.advanceTimersByTimeAsync(39); expect(f.expired).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1); expect(f.expired).toHaveBeenCalledTimes(1);
  });

  it('only an actual iteration grant resets full time and does not orphan overlapping manual tokens', async () => {
    const f = fixture(); await vi.advanceTimersByTimeAsync(20);
    f.budget.resetAfterIterationGrant(); // No pending grant: must not reset ordinary execution.
    const release = f.budget.beginManualToolWait('a');
    f.budget.pauseForIterationApproval();
    await vi.advanceTimersByTimeAsync(100);
    f.budget.resetAfterIterationGrant();
    await vi.advanceTimersByTimeAsync(100); expect(f.expired).not.toHaveBeenCalled();
    release();
    await vi.advanceTimersByTimeAsync(49); expect(f.expired).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1); expect(f.expired).toHaveBeenCalledTimes(1);
  });

  it('a manual scope in one execution cannot pause a different child', async () => {
    const first = fixture();
    const controller = new AbortController();
    const otherExpired = vi.fn();
    const second = createSubagentExecutionBudget({ timeoutMs: 50, signal: controller.signal,
      isCurrent: () => true, onExpired: otherExpired });
    second.start();
    first.budget.beginManualToolWait('same-request-id');
    await vi.advanceTimersByTimeAsync(50);
    expect(first.expired).not.toHaveBeenCalled(); expect(otherExpired).toHaveBeenCalledTimes(1);
    first.budget.dispose(); second.dispose();
  });
});
