import { describe, it, expect, vi } from 'vitest';
import { metricsMiddleware } from '../middleware/metrics.middleware';
import { TurnState } from '../turn-state';
import type { StreamContext } from '../interfaces/stream-context.interface';

function makeCtx(): StreamContext {
  return {
    sessionId: 'sid',
    messageId: 'mid',
    abortSignal: new AbortController().signal,
    state: new TurnState(),
    emit: vi.fn(),
  };
}

describe('metricsMiddleware', () => {
  it('calls next() exactly once', async () => {
    const next = vi.fn().mockResolvedValue(undefined);
    await metricsMiddleware({ type: 'text_delta', delta: 'x' }, makeCtx(), next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('measures duration around next()', async () => {
    const slow = () => new Promise<void>(r => setTimeout(r, 5));
    const next = vi.fn().mockImplementation(slow);
    await expect(
      metricsMiddleware({ type: 'text_delta', delta: 'x' }, makeCtx(), next),
    ).resolves.toBeUndefined();
    expect(next).toHaveBeenCalled();
  });

  it('propagates errors from next()', async () => {
    const next = vi.fn().mockRejectedValue(new Error('boom'));
    await expect(
      metricsMiddleware({ type: 'done' }, makeCtx(), next),
    ).rejects.toThrow('boom');
  });
});
