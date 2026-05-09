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
      onChunk: (c: LLMStreamChunk) => void,
    ): Promise<LLMToolCall[]> => {
      for (const c of plan.chunks) onChunk(c);
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
});
