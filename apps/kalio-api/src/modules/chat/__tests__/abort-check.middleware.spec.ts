import { describe, it, expect, vi } from 'vitest';
import { abortCheckMiddleware } from '../middleware/abort-check.middleware';
import { TurnState } from '../turn-state';
import type { StreamContext } from '../interfaces/stream-context.interface';
import type { InternalLLMChunk } from '../interfaces/llm-chunk.types';

function makeCtx(aborted: boolean): StreamContext {
  const controller = new AbortController();
  if (aborted) controller.abort();
  return {
    sessionId: 'sid',
    messageId: 'mid',
    abortSignal: controller.signal,
    state: new TurnState(),
    emit: vi.fn(),
  };
}

const chunk: InternalLLMChunk = { type: 'text_delta', delta: 'x' };

describe('abortCheckMiddleware', () => {
  it('calls next when signal is not aborted', async () => {
    const next = vi.fn().mockResolvedValue(undefined);
    await abortCheckMiddleware(chunk, makeCtx(false), next);
    expect(next).toHaveBeenCalledOnce();
  });

  it('skips next when signal is aborted', async () => {
    const next = vi.fn().mockResolvedValue(undefined);
    await abortCheckMiddleware(chunk, makeCtx(true), next);
    expect(next).not.toHaveBeenCalled();
  });

  it('does not throw when aborted', async () => {
    await expect(
      abortCheckMiddleware(chunk, makeCtx(true), vi.fn()),
    ).resolves.toBeUndefined();
  });
});
