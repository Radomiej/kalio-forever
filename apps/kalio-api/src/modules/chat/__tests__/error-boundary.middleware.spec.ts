import { describe, it, expect, vi } from 'vitest';
import { errorBoundaryMiddleware } from '../middleware/error-boundary.middleware';
import { TurnErrorAlreadyEmitted } from '../turn-error';
import { TurnState } from '../turn-state';
import type { StreamContext } from '../interfaces/stream-context.interface';
import type { InternalLLMChunk } from '../interfaces/llm-chunk.types';

function makeCtx(): StreamContext & { emit: ReturnType<typeof vi.fn> } {
  const emit = vi.fn();
  return {
    sessionId: 'sid-err',
    messageId: 'mid-err',
    abortSignal: new AbortController().signal,
    state: new TurnState(),
    emit,
  };
}

const chunk: InternalLLMChunk = { type: 'text_delta', delta: 'x' };

describe('errorBoundaryMiddleware', () => {
  it('passes through when next succeeds', async () => {
    const next = vi.fn().mockResolvedValue(undefined);
    const ctx = makeCtx();
    await errorBoundaryMiddleware(chunk, ctx, next);
    expect(next).toHaveBeenCalledOnce();
    expect(ctx.emit).not.toHaveBeenCalled();
  });

  it('emits chat:error when next throws', async () => {
    const ctx = makeCtx();
    const next = vi.fn().mockRejectedValue(new Error('boom'));

    await expect(errorBoundaryMiddleware(chunk, ctx, next)).rejects.toThrow();

    expect(ctx.emit).toHaveBeenCalledWith('chat:error', {
      sessionId: 'sid-err',
      code: 'LLM_ERROR',
      message: 'boom',
    });
  });

  it('wraps re-thrown error as TurnErrorAlreadyEmitted', async () => {
    const ctx = makeCtx();
    const next = vi.fn().mockRejectedValue(new Error('original error'));

    await expect(errorBoundaryMiddleware(chunk, ctx, next)).rejects.toBeInstanceOf(
      TurnErrorAlreadyEmitted,
    );
  });

  it('preserves the original message in TurnErrorAlreadyEmitted', async () => {
    const ctx = makeCtx();
    const next = vi.fn().mockRejectedValue(new Error('detail message'));

    try {
      await errorBoundaryMiddleware(chunk, ctx, next);
    } catch (err) {
      expect(err).toBeInstanceOf(TurnErrorAlreadyEmitted);
      expect((err as TurnErrorAlreadyEmitted).message).toBe('detail message');
    }
  });

  it('handles non-Error throws', async () => {
    const ctx = makeCtx();
    const next = vi.fn().mockRejectedValue('string error');
    await expect(errorBoundaryMiddleware(chunk, ctx, next)).rejects.toBeInstanceOf(
      TurnErrorAlreadyEmitted,
    );
    expect(ctx.emit).toHaveBeenCalledWith('chat:error', {
      sessionId: 'sid-err',
      code: 'LLM_ERROR',
      message: 'string error',
    });
  });
});
