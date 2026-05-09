import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TextDeltaHandler } from '../handlers/text-delta.handler';
import { TurnState } from '../turn-state';

function makeCtx(): { sessionId: string; messageId: string; abortSignal: AbortSignal; state: TurnState; emit: ReturnType<typeof vi.fn> } {
  const emit = vi.fn();
  return {
    sessionId: 'sid-01',
    messageId: 'mid-01',
    abortSignal: new AbortController().signal,
    state: new TurnState(),
    emit,
  };
}

describe('TextDeltaHandler', () => {
  let handler: TextDeltaHandler;

  beforeEach(() => {
    handler = new TextDeltaHandler();
  });

  it('has chunkType "text_delta"', () => {
    expect(handler.chunkType).toBe('text_delta');
  });

  it('appends delta to state.text', async () => {
    const ctx = makeCtx();
    await handler.handle({ type: 'text_delta', delta: 'Hello' }, ctx);
    expect(ctx.state.text).toBe('Hello');
  });

  it('accumulates multiple deltas in state.text', async () => {
    const ctx = makeCtx();
    await handler.handle({ type: 'text_delta', delta: 'Hello' }, ctx);
    await handler.handle({ type: 'text_delta', delta: ' world' }, ctx);
    expect(ctx.state.text).toBe('Hello world');
  });

  it('emits chat:chunk with correct shape', async () => {
    const ctx = makeCtx();
    await handler.handle({ type: 'text_delta', delta: 'Hi' }, ctx);
    expect(ctx.emit).toHaveBeenCalledWith('chat:chunk', {
      delta: 'Hi',
      done: false,
      sessionId: 'sid-01',
      messageId: 'mid-01',
    });
  });

  it('emits once per call', async () => {
    const ctx = makeCtx();
    await handler.handle({ type: 'text_delta', delta: 'x' }, ctx);
    expect(ctx.emit).toHaveBeenCalledTimes(1);
  });

  it('does not emit thinking flag', async () => {
    const ctx = makeCtx();
    await handler.handle({ type: 'text_delta', delta: 'x' }, ctx);
    const payload = ctx.emit.mock.calls[0][1] as Record<string, unknown>;
    expect(payload['thinking']).toBeUndefined();
  });
});
