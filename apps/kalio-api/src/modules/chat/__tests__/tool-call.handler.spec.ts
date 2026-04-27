import { describe, it, expect, vi } from 'vitest';
import { ToolCallHandler } from '../handlers/tool-call.handler';
import { TurnState } from '../turn-state';
import type { StreamContext } from '../interfaces/stream-context.interface';

function makeCtx(): StreamContext & { emit: ReturnType<typeof vi.fn> } {
  const emit = vi.fn();
  return {
    sessionId: 'sid-03',
    messageId: 'mid-03',
    abortSignal: new AbortController().signal,
    state: new TurnState(),
    emit,
  };
}

describe('ToolCallHandler (collect-only)', () => {
  const handler = new ToolCallHandler();

  it('has chunkType "tool_call"', () => {
    expect(handler.chunkType).toBe('tool_call');
  });

  it('adds tool call to state.toolCalls', async () => {
    const ctx = makeCtx();
    await handler.handle({ type: 'tool_call', callId: 'call-1', name: 'my_tool', args: { x: 1 } }, ctx);
    expect(ctx.state.toolCalls).toEqual([{ id: 'call-1', name: 'my_tool', args: { x: 1 } }]);
  });

  it('does NOT emit any events (dispatch happens after stream in ChatService)', async () => {
    const ctx = makeCtx();
    await handler.handle({ type: 'tool_call', callId: 'c1', name: 't', args: {} }, ctx);
    expect(ctx.emit).not.toHaveBeenCalled();
  });

  it('preserves order across multiple tool_call chunks in one iteration', async () => {
    const ctx = makeCtx();
    await handler.handle({ type: 'tool_call', callId: 'c1', name: 'a', args: {} }, ctx);
    await handler.handle({ type: 'tool_call', callId: 'c2', name: 'b', args: {} }, ctx);
    await handler.handle({ type: 'tool_call', callId: 'c3', name: 'c', args: {} }, ctx);
    expect(ctx.state.toolCalls.map((tc) => tc.id)).toEqual(['c1', 'c2', 'c3']);
  });
});
