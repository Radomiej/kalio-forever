import { describe, expect, it, vi } from 'vitest';
import type { EmitFn, StreamContext } from '../interfaces/stream-context.interface';
import type { ILLMSource } from '../interfaces/llm-source.interface';
import type { InternalLLMChunk } from '../interfaces/llm-chunk.types';
import { LLMTurnRuntimeService } from '../llm-turn-runtime.service';
import type { SessionManagerService } from '../session-manager.service';
import type { StreamProcessorService } from '../stream-processor.service';
import type { ToolDispatchService } from '../tool-dispatch.service';

async function* streamFrom(chunks: InternalLLMChunk[]): AsyncIterable<InternalLLMChunk> {
  for (const chunk of chunks) yield chunk;
}

describe('LLMTurnRuntimeService', () => {
  it('routes every internal stream through llmSource.stream', async () => {
    const llmSource: ILLMSource = {
      stream: vi.fn(() => streamFrom([
        { type: 'text_delta', delta: 'hello' },
        { type: 'done' },
      ])),
    };
    const sessionManager = {
      loadHistoryForLLM: vi.fn().mockResolvedValue({
        history: [{ role: 'system', content: 'prompt' }],
        unboundedHistoryCount: 1,
      }),
      saveToolResult: vi.fn().mockResolvedValue(undefined),
    } satisfies Pick<SessionManagerService, 'loadHistoryForLLM' | 'saveToolResult'>;
    const processor = {
      process: vi.fn(async (chunk: InternalLLMChunk, ctx: { state: { appendText: (delta: string) => void } }) => {
        if (chunk.type === 'text_delta') ctx.state.appendText(chunk.delta);
      }),
    } satisfies Pick<StreamProcessorService, 'process'>;
    const runtime = new LLMTurnRuntimeService(
      llmSource,
      processor as unknown as StreamProcessorService,
      sessionManager as unknown as SessionManagerService,
      { dispatch: vi.fn() } as unknown as ToolDispatchService,
    );
    const emit = vi.fn() as EmitFn;

    const result = await runtime.runAgentLoop({
      runtimeKind: 'chat',
      sessionId: 'sid',
      turnId: 'turn-1',
      promptMessageId: 'user-1',
      personaId: 'persona-1',
      effectiveSystemPrompt: 'prompt',
      toolMetas: [],
      abortSignal: new AbortController().signal,
      emit,
      maxIterations: 3,
    });

    expect(llmSource.stream).toHaveBeenCalledTimes(1);
    expect(result.finalText).toBe('hello');
    expect(sessionManager.loadHistoryForLLM).toHaveBeenCalledWith('sid', {
      systemPrompt: 'prompt',
      toolMetas: [],
    });
  });

  it('persists tool results with the opening prompt linkage for the turn', async () => {
    const llmSource: ILLMSource = {
      stream: vi.fn(() => streamFrom([
        { type: 'tool_call', callId: 'call-1', name: 'memory_search', args: { q: 'x' } },
        { type: 'done' },
      ])),
    };
    const sessionManager = {
      loadHistoryForLLM: vi.fn().mockResolvedValue({
        history: [{ role: 'system', content: 'prompt' }],
        unboundedHistoryCount: 1,
      }),
      saveToolResult: vi.fn().mockResolvedValue(undefined),
    } satisfies Pick<SessionManagerService, 'loadHistoryForLLM' | 'saveToolResult'>;
    const processor = {
      process: vi.fn(async (chunk: InternalLLMChunk, ctx: StreamContext) => {
        if (chunk.type === 'tool_call') {
          ctx.state.addToolCall({ id: chunk.callId, name: chunk.name, args: chunk.args });
        }
      }),
    } satisfies Pick<StreamProcessorService, 'process'>;
    const toolDispatch = {
      dispatch: vi.fn().mockResolvedValue({ callId: 'call-1', status: 'success', data: { hits: [] } }),
    } satisfies Pick<ToolDispatchService, 'dispatch'>;
    const runtime = new LLMTurnRuntimeService(
      llmSource,
      processor as unknown as StreamProcessorService,
      sessionManager as unknown as SessionManagerService,
      toolDispatch as unknown as ToolDispatchService,
    );

    await runtime.runAgentLoop({
      runtimeKind: 'chat',
      sessionId: 'sid',
      turnId: 'turn-1',
      promptMessageId: 'user-1',
      personaId: 'persona-1',
      effectiveSystemPrompt: 'prompt',
      toolMetas: [],
      abortSignal: new AbortController().signal,
      emit: vi.fn() as EmitFn,
      maxIterations: 1,
    });

    expect(sessionManager.saveToolResult).toHaveBeenCalledWith(
      'sid',
      'call-1',
      JSON.stringify({ hits: [] }),
      { turnId: 'turn-1', promptMessageId: 'user-1' },
    );
  });

  it('applies transformToolCall before emit, dispatch, and persistence', async () => {
    const llmSource: ILLMSource = {
      stream: vi.fn(() => streamFrom([
        { type: 'tool_call', callId: 'call-1', name: 'run_raapp', args: { id: 'wrong-id' } },
        { type: 'done' },
      ])),
    };
    const sessionManager = {
      loadHistoryForLLM: vi.fn().mockResolvedValue({
        history: [{ role: 'system', content: 'prompt' }],
        unboundedHistoryCount: 1,
      }),
      saveToolResult: vi.fn().mockResolvedValue(undefined),
    } satisfies Pick<SessionManagerService, 'loadHistoryForLLM' | 'saveToolResult'>;
    const processor = {
      process: vi.fn(async (chunk: InternalLLMChunk, ctx: StreamContext) => {
        if (chunk.type === 'tool_call') {
          ctx.state.addToolCall({ id: chunk.callId, name: chunk.name, args: chunk.args });
        }
      }),
    } satisfies Pick<StreamProcessorService, 'process'>;
    const toolDispatch = {
      dispatch: vi.fn().mockResolvedValue({ callId: 'call-1', status: 'success', data: { ok: true } }),
    } satisfies Pick<ToolDispatchService, 'dispatch'>;
    const runtime = new LLMTurnRuntimeService(
      llmSource,
      processor as unknown as StreamProcessorService,
      sessionManager as unknown as SessionManagerService,
      toolDispatch as unknown as ToolDispatchService,
    );
    const emit = vi.fn() as EmitFn;

    await runtime.runAgentLoop({
      runtimeKind: 'chat',
      sessionId: 'sid',
      turnId: 'turn-1',
      promptMessageId: 'user-1',
      personaId: 'persona-1',
      effectiveSystemPrompt: 'prompt',
      toolMetas: [],
      abortSignal: new AbortController().signal,
      emit,
      maxIterations: 1,
      transformToolCall: (toolCall) => ({
        ...toolCall,
        args: { ...toolCall.args, id: 'right-id' },
      }),
    });

    expect(emit).toHaveBeenCalledWith('tool:start', expect.objectContaining({
      toolName: 'run_raapp',
      args: { id: 'right-id' },
    }));
    expect(toolDispatch.dispatch).toHaveBeenCalledWith(
      'call-1',
      'run_raapp',
      { id: 'right-id' },
      expect.any(Object),
      [],
    );
    expect(sessionManager.saveToolResult).toHaveBeenCalledWith(
      'sid',
      'call-1',
      JSON.stringify({ ok: true }),
      { turnId: 'turn-1', promptMessageId: 'user-1' },
    );
  });

  it('loads branch history from an explicit historySessionId when provided', async () => {
    const llmSource: ILLMSource = {
      stream: vi.fn(() => streamFrom([
        { type: 'text_delta', delta: 'branch answer' },
        { type: 'done' },
      ])),
    };
    const sessionManager = {
      loadHistoryForLLM: vi.fn().mockResolvedValue({
        history: [{ role: 'system', content: 'prompt' }],
        unboundedHistoryCount: 1,
      }),
      saveToolResult: vi.fn().mockResolvedValue(undefined),
    } satisfies Pick<SessionManagerService, 'loadHistoryForLLM' | 'saveToolResult'>;
    const runtime = new LLMTurnRuntimeService(
      llmSource,
      {
        process: vi.fn(async (chunk: InternalLLMChunk, ctx: { state: { appendText: (delta: string) => void } }) => {
          if (chunk.type === 'text_delta') ctx.state.appendText(chunk.delta);
        }),
      } as unknown as StreamProcessorService,
      sessionManager as unknown as SessionManagerService,
      { dispatch: vi.fn() } as unknown as ToolDispatchService,
    );

    await runtime.runAgentLoop({
      runtimeKind: 'agent-flow-branch',
      sessionId: 'branch-session',
      historySessionId: 'host-session',
      turnId: 'turn-2',
      promptMessageId: 'user-2',
      personaId: 'persona-1',
      effectiveSystemPrompt: 'prompt',
      toolMetas: [],
      abortSignal: new AbortController().signal,
      emit: vi.fn() as EmitFn,
      maxIterations: 2,
    });

    expect(sessionManager.loadHistoryForLLM).toHaveBeenCalledWith('branch-session', {
      systemPrompt: 'prompt',
      toolMetas: [],
      historySessionId: 'host-session',
    });
  });
});
