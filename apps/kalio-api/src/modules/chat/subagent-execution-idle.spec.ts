import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSubagentExecutionBudget } from './subagent-execution-budget';

beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
function fixture(mode: 'active' | 'idle' = 'idle') {
  const controller = new AbortController(); let current = true;
  const expired = vi.fn((error: Error) => controller.abort(error));
  const budget = createSubagentExecutionBudget({ timeoutMs: 50, mode, signal: controller.signal,
    isCurrent: () => current, onExpired: expired });
  budget.start(); return { budget, controller, expired, stale: () => { current = false; } };
}
describe('architecture communication inactivity clock', () => {
  it('permits actual progress across several timeout windows, then expires on silence', async () => {
    const f = fixture();
    for (let i = 0; i < 5; i++) { await vi.advanceTimersByTimeAsync(40); f.budget.noteActivity(); expect(f.expired).not.toHaveBeenCalled(); }
    await vi.advanceTimersByTimeAsync(49); expect(f.expired).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1); expect(f.expired).toHaveBeenCalledOnce();
  });
  it('does not reset an ordinary direct-subagent active budget', async () => {
    const f = fixture('active'); await vi.advanceTimersByTimeAsync(30); f.budget.noteActivity();
    await vi.advanceTimersByTimeAsync(20); expect(f.expired).toHaveBeenCalledOnce();
  });
  it('refreshes paused allowance without arming until every manual wait is released', async () => {
    const f = fixture(); await vi.advanceTimersByTimeAsync(20);
    const a = f.budget.beginManualToolWait('a'), b = f.budget.beginManualToolWait('b');
    await vi.advanceTimersByTimeAsync(1000); f.budget.noteActivity(); expect(vi.getTimerCount()).toBe(0);
    a(); a(); await vi.advanceTimersByTimeAsync(1000); expect(f.expired).not.toHaveBeenCalled();
    b(); await vi.advanceTimersByTimeAsync(49); expect(f.expired).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1); expect(f.expired).toHaveBeenCalledOnce();
  });
  it('preserves the paused remainder when there was no progress', async () => {
    const f = fixture(); await vi.advanceTimersByTimeAsync(20); const release = f.budget.beginManualToolWait('a');
    await vi.advanceTimersByTimeAsync(1000); release();
    await vi.advanceTimersByTimeAsync(29); expect(f.expired).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1); expect(f.expired).toHaveBeenCalledOnce();
  });
  it('cannot revive a deadline elapsed before its timer callback ran', () => {
    const f = fixture(); vi.spyOn(performance, 'now').mockReturnValue(performance.now() + 50);
    f.budget.noteActivity(); expect(f.expired).toHaveBeenCalledOnce(); f.budget.noteActivity(); expect(vi.getTimerCount()).toBe(0);
  });
  it.each(['abort', 'dispose', 'stale'] as const)('cannot rearm after %s', async mode => {
    const f = fixture(); if (mode === 'abort') f.controller.abort(); if (mode === 'dispose') f.budget.dispose(); if (mode === 'stale') f.stale();
    f.budget.noteActivity(); await vi.advanceTimersByTimeAsync(500); expect(f.expired).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });
  it('ignores an old timer after renewed activity', async () => {
    const f = fixture(); const timers = vi.spyOn(globalThis, 'setTimeout'); f.budget.noteActivity();
    const old = timers.mock.calls[0]?.[0] as (() => void) | undefined; expect(old).toBeTypeOf('function');
    await vi.advanceTimersByTimeAsync(20); f.budget.noteActivity(); old!(); expect(f.expired).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(49); expect(f.expired).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1); expect(f.expired).toHaveBeenCalledOnce();
  });
});
