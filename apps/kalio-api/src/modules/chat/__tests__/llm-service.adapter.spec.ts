import { describe, it, expect, vi } from 'vitest';
import { LLMServiceAdapter } from '../llm-service.adapter';
import type { LLMService } from '../../llm/llm.service';
import type { InternalLLMChunk } from '../interfaces/llm-chunk.types';
import type { LLMToolCall, LLMStreamChunk } from '@kalio/types';

interface FakeStream {
  chunks: LLMStreamChunk[];
  toolCalls: LLMToolCall[];
  error?: Error;
}

function makeLLM(plan: FakeStream): LLMService {
  const streamChat = vi.fn().mockImplementation(
    async (
      _msgs: unknown,
      _tools: unknown,
      options: { onChunk: (c: LLMStreamChunk) => void },
    ): Promise<LLMToolCall[]> => {
      for (const c of plan.chunks) options.onChunk(c);
      if (plan.error) throw plan.error;
      return plan.toolCalls;
    },
  );
  return { streamChat } as unknown as LLMService;
}

async function collect(it: AsyncIterable<InternalLLMChunk>): Promise<InternalLLMChunk[]> {
  const out: InternalLLMChunk[] = [];
  for await (const c of it) out.push(c);
  return out;
}

const baseParams = {
  messages: [{ role: 'user' as const, content: 'hi' }],
  tools: [],
  sessionId: 'sid',
  messageId: 'mid',
};

describe('LLMServiceAdapter', () => {
  it('emits text_delta for non-thinking chunks then done', async () => {
    const adapter = new LLMServiceAdapter(makeLLM({
      chunks: [
        { delta: 'Hello', thinking: false, done: false, sessionId: 'sid', messageId: 'mid' },
        { delta: ' world', thinking: false, done: false, sessionId: 'sid', messageId: 'mid' },
      ],
      toolCalls: [],
    }));
    const out = await collect(adapter.stream(baseParams));
    expect(out).toEqual([
      { type: 'text_delta', delta: 'Hello' },
      { type: 'text_delta', delta: ' world' },
      { type: 'done' },
    ]);
  });

  it('emits thinking_delta for thinking chunks', async () => {
    const adapter = new LLMServiceAdapter(makeLLM({
      chunks: [{ delta: 'reasoning', thinking: true, done: false, sessionId: 'sid', messageId: 'mid' }],
      toolCalls: [],
    }));
    const out = await collect(adapter.stream(baseParams));
    expect(out[0]).toEqual({ type: 'thinking_delta', delta: 'reasoning' });
  });

  it('emits tool_call chunks before done', async () => {
    const adapter = new LLMServiceAdapter(makeLLM({
      chunks: [],
      toolCalls: [{ id: 'c1', name: 'foo', args: { x: 1 } }],
    }));
    const out = await collect(adapter.stream(baseParams));
    expect(out).toEqual([
      { type: 'tool_call', callId: 'c1', name: 'foo', args: { x: 1 } },
      { type: 'done' },
    ]);
  });

  it('skips chunks with empty delta', async () => {
    const adapter = new LLMServiceAdapter(makeLLM({
      chunks: [
        { delta: '', thinking: false, done: false, sessionId: 'sid', messageId: 'mid' },
        { delta: 'x', thinking: false, done: false, sessionId: 'sid', messageId: 'mid' },
      ],
      toolCalls: [],
    }));
    const out = await collect(adapter.stream(baseParams));
    const textChunks = out.filter(c => c.type === 'text_delta');
    expect(textChunks).toHaveLength(1);
  });

  it('throws when underlying stream rejects', async () => {
    const adapter = new LLMServiceAdapter(makeLLM({
      chunks: [],
      toolCalls: [],
      error: new Error('LLM down'),
    }));
    await expect(collect(adapter.stream(baseParams))).rejects.toThrow('LLM down');
  });

  it('stops upstream work when the streaming iterator is closed early', async () => {
    let release!: () => void;
    const upstreamChunks: string[] = [];
    let upstreamAbortSignal: AbortSignal | undefined;
    const llm = {
      streamChat: vi.fn().mockImplementation(async (
        _msgs: unknown,
        _tools: unknown,
        options: { onChunk: (c: LLMStreamChunk) => void; abortSignal?: AbortSignal },
      ): Promise<LLMToolCall[]> => {
        upstreamAbortSignal = options.abortSignal;
        upstreamChunks.push('first');
        options.onChunk({ delta: 'first', thinking: false, done: false, sessionId: 'sid', messageId: 'mid' });
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        if (options.abortSignal?.aborted) {
          return [];
        }
        upstreamChunks.push('second');
        options.onChunk({ delta: 'second', thinking: false, done: false, sessionId: 'sid', messageId: 'mid' });
        return [];
      }),
    } as unknown as LLMService;
    const adapter = new LLMServiceAdapter(llm);
    const iterator = adapter.stream(baseParams)[Symbol.asyncIterator]();

    await expect(iterator.next()).resolves.toEqual({ value: { type: 'text_delta', delta: 'first' }, done: false });
    await expect(iterator.return?.(undefined)).resolves.toEqual({ value: undefined, done: true });
    expect(upstreamAbortSignal?.aborted).toBe(true);

    release();
    await Promise.resolve();
    await Promise.resolve();

    expect(upstreamChunks).toEqual(['first']);
    expect(llm.streamChat).toHaveBeenCalledOnce();
  });

  it('does not start the upstream stream when the parent abort signal is already aborted', async () => {
    const abortController = new AbortController();
    abortController.abort(new Error('cancelled before start'));
    const llm = {
      streamChat: vi.fn(),
    } as unknown as LLMService;
    const adapter = new LLMServiceAdapter(llm);

    const out = await collect(adapter.stream({
      ...baseParams,
      abortSignal: abortController.signal,
    }));

    expect(out).toEqual([]);
    expect(llm.streamChat).not.toHaveBeenCalled();
  });

  it('stops cleanly on parent abort without emitting trailing tool calls or done', async () => {
    let release!: () => void;
    const abortController = new AbortController();
    const llm = {
      streamChat: vi.fn().mockImplementation(async (
        _msgs: unknown,
        _tools: unknown,
        options: { onChunk: (c: LLMStreamChunk) => void; abortSignal?: AbortSignal },
      ): Promise<LLMToolCall[]> => {
        options.onChunk({ delta: 'first', thinking: false, done: false, sessionId: 'sid', messageId: 'mid' });
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        if (options.abortSignal?.aborted) {
          const error = new Error('stream aborted');
          error.name = 'AbortError';
          throw error;
        }
        return [{ id: 'late-call', name: 'late_tool', args: { ok: true } }];
      }),
    } as unknown as LLMService;
    const adapter = new LLMServiceAdapter(llm);
    const iterator = adapter.stream({
      ...baseParams,
      abortSignal: abortController.signal,
    })[Symbol.asyncIterator]();

    await expect(iterator.next()).resolves.toEqual({ value: { type: 'text_delta', delta: 'first' }, done: false });

    abortController.abort(new Error('user stopped turn'));
    release();

    await expect(iterator.next()).resolves.toEqual({ value: undefined, done: true });
    await expect(iterator.next()).resolves.toEqual({ value: undefined, done: true });
    expect(llm.streamChat).toHaveBeenCalledOnce();
  });
});
