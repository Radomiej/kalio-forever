import { expect, it, vi } from 'vitest';
import type { ChatMessage } from '@kalio/types';
import { LLMTurnRuntimeService } from '../llm-turn-runtime.service';
import { SessionManagerService } from '../session-manager.service';
import { StreamProcessorService } from '../stream-processor.service';
import { TextDeltaHandler } from '../handlers/text-delta.handler';
import { ThinkingDeltaHandler } from '../handlers/thinking-delta.handler';
import { DoneHandler } from '../handlers/done.handler';
import type { ToolDispatchService } from '../tool-dispatch.service';
import type { IMessageRepository } from '../interfaces/message-repository.interface';
import type { InternalLLMChunk } from '../interfaces/llm-chunk.types';

it.each(['text_delta', 'thinking_delta'] as const)('preserves cancelled %s content with durable turn linkage', async (kind) => {
  const saved: ChatMessage[] = [];
  const repo: IMessageRepository = {
    ensureSession: async () => undefined,
    loadMessagesForTurn: async () => [],
    loadHistory: async () => saved,
    loadHistoryPage: async () => ({ messages: saved, totalCount: saved.length, hasMoreBefore: false, oldestLoadedMessageId: saved[0]?.id ?? null }),
    saveMessage: async (message) => { const index = saved.findIndex((entry) => entry.id === message.id);
      if (index < 0) saved.push(message); else saved[index] = message; },
  };
  const manager = new SessionManagerService(repo,
    {} as ConstructorParameters<typeof SessionManagerService>[1],
    {} as ConstructorParameters<typeof SessionManagerService>[2],
    {} as ConstructorParameters<typeof SessionManagerService>[3]);
  vi.spyOn(manager, 'loadHistoryForLLM').mockResolvedValue({ history: [], unboundedHistoryCount: 0, compacted: false });
  const processor = new StreamProcessorService([new TextDeltaHandler(), new ThinkingDeltaHandler(), new DoneHandler(manager)], []);
  processor.onModuleInit();
  const controller = new AbortController();
  const source = { async *stream(): AsyncIterable<InternalLLMChunk> {
    yield { type: kind, delta: 'Visible partial response' };
    controller.abort();
  } };
  const runtime = new LLMTurnRuntimeService(source, processor, manager, {} as ToolDispatchService);
  const result = await runtime.runAgentLoop({ runtimeKind: 'chat', sessionId: 'session', personaId: 'persona',
    firstMessageId: 'partial', turnId: 'stopped-turn', promptMessageId: 'user-prompt', effectiveSystemPrompt: '',
    toolMetas: [], abortSignal: controller.signal, emit: vi.fn(), maxIterations: 1 });
  expect(result.aborted).toBe(true);
  expect(result.finalText).toBe(kind === 'text_delta' ? 'Visible partial response' : '');
  expect(saved).toHaveLength(1);
  expect(saved[0]).toMatchObject({ id: 'partial', sessionId: 'session', role: 'assistant', turnId: 'stopped-turn', promptMessageId: 'user-prompt',
    ...(kind === 'text_delta' ? { content: 'Visible partial response' } : { content: '', thinking: 'Visible partial response' }) });
});
