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

it.each([
  ['text_delta', false, false, false, true], ['thinking_delta', false, false, false, true],
  ['text_delta', true, false, false, true], ['thinking_delta', true, false, false, true],
  ['text_delta', false, false, true, true],
  ['text_delta', false, true, false, true],
  ['text_delta', false, false, false, false],
] as const)('failed %s recovery (abort=%s, DB failure=%s, poisoned lane=%s, content=%s)', async (kind, externalAbort, persistenceFails, emitFails, hasContent) => {
  const saved: ChatMessage[] = [];
  const repo: IMessageRepository = {
    ensureSession: async () => undefined,
    loadHistory: async () => saved,
    loadHistoryPage: async () => ({ messages: saved, totalCount: saved.length, hasMoreBefore: false, oldestLoadedMessageId: saved[0]?.id ?? null }),
    saveMessage: async message => {
      if (persistenceFails) throw new Error('History database unavailable');
      const index = saved.findIndex(entry => entry.id === message.id);
      if (index < 0) saved.push(message); else saved[index] = message;
    },
  };
  const manager = new SessionManagerService(repo,
    {} as ConstructorParameters<typeof SessionManagerService>[1],
    {} as ConstructorParameters<typeof SessionManagerService>[2],
    {} as ConstructorParameters<typeof SessionManagerService>[3]);
  vi.spyOn(manager, 'loadHistoryForLLM').mockResolvedValue({ history: [], unboundedHistoryCount: 0, compacted: false });
  const processor = new StreamProcessorService([new TextDeltaHandler(), new ThinkingDeltaHandler(), new DoneHandler(manager)], []);
  processor.onModuleInit();
  const controller = new AbortController();
  const providerError = new Error('External host lost');
  const emitError = new Error('Stream delivery failed');
  const source = { async *stream(): AsyncIterable<InternalLLMChunk> {
    if (hasContent) yield { type: kind, delta: 'Visible before host loss' };
    if (externalAbort) controller.abort();
    throw providerError;
  } };
  const runtime = new LLMTurnRuntimeService(source, processor, manager, {} as ToolDispatchService);
  await expect(runtime.runAgentLoop({ runtimeKind: 'chat', sessionId: 'session', personaId: 'persona',
    firstMessageId: 'partial', turnId: 'failed-turn', promptMessageId: 'user-prompt', effectiveSystemPrompt: '',
    toolMetas: [], abortSignal: controller.signal, emit: () => { if (emitFails) throw emitError; }, maxIterations: 1 })).rejects.toBe(emitFails ? emitError : providerError);
  expect(saved).toHaveLength(persistenceFails || !hasContent ? 0 : 1);
  if (persistenceFails || !hasContent) return;
  expect(saved[0]).toMatchObject({ id: 'partial', sessionId: 'session', role: 'assistant', turnId: 'failed-turn', promptMessageId: 'user-prompt',
    ...(kind === 'text_delta' ? { content: 'Visible before host loss' } : { content: '', thinking: 'Visible before host loss' }) });
});
