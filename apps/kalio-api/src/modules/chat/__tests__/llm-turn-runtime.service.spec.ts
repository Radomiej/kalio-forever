import { describe, expect, it, vi } from 'vitest';
import type { EmitFn } from '../interfaces/stream-context.interface';
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
});
