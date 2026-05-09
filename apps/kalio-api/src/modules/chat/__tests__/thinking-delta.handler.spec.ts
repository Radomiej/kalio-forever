import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ThinkingDeltaHandler } from '../handlers/thinking-delta.handler';
import { TurnState } from '../turn-state';
import type { StreamContext } from '../interfaces/stream-context.interface';

function makeCtx(): StreamContext & { emit: ReturnType<typeof vi.fn> } {
  const emit = vi.fn();
  return {
    sessionId: 'sid-02',
    messageId: 'mid-02',
    abortSignal: new AbortController().signal,
    state: new TurnState(),
    emit,
  };
}

describe('ThinkingDeltaHandler', () => {
  let handler: ThinkingDeltaHandler;

  beforeEach(() => {
    handler = new ThinkingDeltaHandler();
  });

  it('has chunkType "thinking_delta"', () => {
    expect(handler.chunkType).toBe('thinking_delta');
  });

  it('appends delta to state.thinking', async () => {
    const ctx = makeCtx();
    await handler.handle({ type: 'thinking_delta', delta: 'thinking...' }, ctx);
    expect(ctx.state.thinking).toBe('thinking...');
  });

  it('does not affect state.text', async () => {
    const ctx = makeCtx();
    await handler.handle({ type: 'thinking_delta', delta: 'reasoning' }, ctx);
    expect(ctx.state.text).toBe('');
  });

  it('emits chat:chunk with thinking=true', async () => {
    const ctx = makeCtx();
    await handler.handle({ type: 'thinking_delta', delta: 'step 1' }, ctx);
    expect(ctx.emit).toHaveBeenCalledWith('chat:chunk', {
      delta: 'step 1',
      done: false,
      sessionId: 'sid-02',
      messageId: 'mid-02',
      thinking: true,
    });
  });

  it('accumulates multiple thinking deltas', async () => {
    const ctx = makeCtx();
    await handler.handle({ type: 'thinking_delta', delta: 'step 1 ' }, ctx);
    await handler.handle({ type: 'thinking_delta', delta: 'step 2' }, ctx);
    expect(ctx.state.thinking).toBe('step 1 step 2');
    expect(ctx.emit).toHaveBeenCalledTimes(2);
  });
});
