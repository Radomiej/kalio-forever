import { describe, it, expect, vi } from 'vitest';
import { errorBoundaryMiddleware } from '../middleware/error-boundary.middleware';
import { TurnErrorAlreadyEmitted } from '../turn-error';
import { TurnState } from '../turn-state';
import type { StreamContext } from '../interfaces/stream-context.interface';
import type { InternalLLMChunk } from '../interfaces/llm-chunk.types';

function makeCtx(hadContent = false): StreamContext & { emit: ReturnType<typeof vi.fn> } {
  const emit = vi.fn();
  const state = new TurnState();
  state.hadContent = hadContent;
  return {
    sessionId: 'sid-err',
    messageId: 'mid-err',
    abortSignal: new AbortController().signal,
    state,
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

  it('emits hadContent=false when error occurs before any chunk', async () => {
    const ctx = makeCtx(false); // no chunk emitted yet
    const next = vi.fn().mockRejectedValue(new Error('boom'));

    await expect(errorBoundaryMiddleware(chunk, ctx, next)).rejects.toThrow();

    expect(ctx.emit).toHaveBeenCalledWith('chat:error', {
      sessionId: 'sid-err',
      code: 'LLM_ERROR',
      message: 'boom',
      hadContent: false,
    });
  });

  it('emits hadContent=true when error occurs after chunks were streamed', async () => {
    const ctx = makeCtx(true); // hadContent already set by TextDeltaHandler
    const next = vi.fn().mockRejectedValue(new Error('mid-stream failure'));

    await expect(errorBoundaryMiddleware(chunk, ctx, next)).rejects.toThrow();

    expect(ctx.emit).toHaveBeenCalledWith('chat:error', {
      sessionId: 'sid-err',
      code: 'LLM_ERROR',
      message: 'mid-stream failure',
      hadContent: true,
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
      hadContent: false,
    });
  });
});
