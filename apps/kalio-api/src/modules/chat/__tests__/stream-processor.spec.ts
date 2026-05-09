import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { StreamProcessorService } from '../stream-processor.service';
import { TextDeltaHandler } from '../handlers/text-delta.handler';
import { ThinkingDeltaHandler } from '../handlers/thinking-delta.handler';
import { DoneHandler } from '../handlers/done.handler';
import { ToolCallHandler } from '../handlers/tool-call.handler';
import { TurnState } from '../turn-state';
import { abortCheckMiddleware } from '../middleware/abort-check.middleware';
import { CHUNK_HANDLERS, STREAM_MIDDLEWARES } from '../chat.tokens';
import type { StreamContext } from '../interfaces/stream-context.interface';
import { SessionManagerService } from '../session-manager.service';
import { ToolDispatchService } from '../tool-dispatch.service';
import type { ToolResult } from '@kalio/types';

function makeCtx(aborted = false): StreamContext & { emit: ReturnType<typeof vi.fn> } {
  const controller = new AbortController();
  if (aborted) controller.abort();
  const emit = vi.fn();
  return {
    sessionId: 'sid',
    messageId: 'mid',
    abortSignal: controller.signal,
    state: new TurnState(),
    emit,
  };
}

const toolResult: ToolResult = { callId: 'c1', status: 'success', data: null };

describe('StreamProcessorService', () => {
  let processor: StreamProcessorService;
  let sessionManager: Partial<SessionManagerService>;
  let toolDispatch: Partial<ToolDispatchService>;

  beforeEach(async () => {
    sessionManager = {
      persistAssistantMessage: vi.fn().mockResolvedValue(undefined),
      saveToolResult: vi.fn().mockResolvedValue(undefined),
    };
    toolDispatch = {
      dispatch: vi.fn().mockResolvedValue(toolResult),
      getToolMetas: vi.fn().mockReturnValue([]),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        StreamProcessorService,
        TextDeltaHandler,
        ThinkingDeltaHandler,
        { provide: SessionManagerService, useValue: sessionManager },
        { provide: ToolDispatchService, useValue: toolDispatch },
        DoneHandler,
        ToolCallHandler,
        {
          provide: CHUNK_HANDLERS,
          useFactory: (
            td: TextDeltaHandler,
            thi: ThinkingDeltaHandler,
            tc: ToolCallHandler,
            d: DoneHandler,
          ) => [td, thi, tc, d],
          inject: [TextDeltaHandler, ThinkingDeltaHandler, ToolCallHandler, DoneHandler],
        },
        {
          provide: STREAM_MIDDLEWARES,
          useFactory: () => [abortCheckMiddleware],
        },
      ],
    }).compile();

    // Trigger OnModuleInit lifecycle hooks
    await moduleRef.init();
    processor = moduleRef.get(StreamProcessorService);
  });

  it('routes text_delta chunk to TextDeltaHandler', async () => {
    const ctx = makeCtx();
    await processor.process({ type: 'text_delta', delta: 'hello' }, ctx);
    expect(ctx.state.text).toBe('hello');
    expect(ctx.emit).toHaveBeenCalledWith('chat:chunk', expect.objectContaining({ delta: 'hello' }));
  });

  it('routes thinking_delta chunk to ThinkingDeltaHandler', async () => {
    const ctx = makeCtx();
    await processor.process({ type: 'thinking_delta', delta: 'thinking' }, ctx);
    expect(ctx.state.thinking).toBe('thinking');
    expect(ctx.emit).toHaveBeenCalledWith('chat:chunk', expect.objectContaining({ thinking: true }));
  });

  it('routes tool_call chunk to ToolCallHandler (collects to state, does not dispatch)', async () => {
    const ctx = makeCtx();
    await processor.process({ type: 'tool_call', callId: 'c1', name: 'my_tool', args: { x: 1 } }, ctx);
    expect(ctx.state.toolCalls).toEqual([{ id: 'c1', name: 'my_tool', args: { x: 1 } }]);
    // Dispatch is now ChatService's responsibility, fired AFTER the LLM iteration's done chunk
    expect(toolDispatch.dispatch).not.toHaveBeenCalled();
  });

  it('routes done chunk to DoneHandler when assistant payload exists (persists, no chat:complete)', async () => {
    const ctx = makeCtx();
    ctx.state.appendText('hello');
    await processor.process({ type: 'done' }, ctx);
    expect(sessionManager.persistAssistantMessage).toHaveBeenCalled();
    // chat:complete is emitted by ChatService at the end of the agent loop, not here
    expect(ctx.emit).not.toHaveBeenCalledWith('chat:complete', expect.anything());
  });

  it('routes done chunk to DoneHandler for tool-only iterations', async () => {
    const ctx = makeCtx();
    ctx.state.addToolCall({ id: 'c1', name: 'my_tool', args: { x: 1 } });
    await processor.process({ type: 'done' }, ctx);
    expect(sessionManager.persistAssistantMessage).toHaveBeenCalled();
  });

  it('skips handler when abort signal is set (abortCheckMiddleware)', async () => {
    const ctx = makeCtx(true);
    await processor.process({ type: 'text_delta', delta: 'x' }, ctx);
    expect(ctx.state.text).toBe('');
    expect(ctx.emit).not.toHaveBeenCalled();
  });

  it('does not throw for unknown chunk types', async () => {
    const ctx = makeCtx();
    await expect(
      processor.process({ type: 'unknown_type' } as never, ctx),
    ).resolves.toBeUndefined();
  });
});
