import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatSession } from '@kalio/types';
import type { InternalLLMChunk } from '../interfaces/llm-chunk.types';
import type { LLMSourceParams } from '../interfaces/llm-source.interface';
import type { SessionManagerService } from '../session-manager.service';
import type { SessionsService } from '../sessions.service';
import type { ToolDispatchService } from '../tool-dispatch.service';
import type { VFSService } from '../../vfs/vfs.service';
import type { TurnState } from '../turn-state';
import { makeSubagentRuntime } from './llm-runtime-test-harness';

beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
async function* progressing(): AsyncIterable<InternalLLMChunk> {
  for (let i = 0; i < 4; i++) {
    await new Promise<void>(resolve => setTimeout(resolve, 40));
    yield { type: 'text_delta', delta: 'progress ' };
  }
  yield { type: 'done' };
}
describe('actual subagent runtime idle policy selection', () => {
  it.each([
    { architecture: true, ui: true, native: false, expected: 'resolved' },
    { architecture: true, ui: false, native: false, expected: 'resolved' },
    { architecture: false, ui: true, native: false, expected: 'rejected' },
    { architecture: true, ui: true, native: true, expected: 'resolved' },
    { architecture: true, ui: false, native: true, expected: 'resolved' },
    { architecture: false, ui: false, native: true, expected: 'rejected' },
  ])('selects architecture=$architecture UI=$ui native=$native', async ({ architecture, ui, native, expected }) => {
    const sessionManager = {
      persistUserMessage: vi.fn().mockResolvedValue(undefined), persistAssistantMessage: vi.fn().mockResolvedValue(undefined),
      saveToolResult: vi.fn().mockResolvedValue(undefined), loadHistory: vi.fn().mockResolvedValue([]),
      loadHistoryForLLM: vi.fn().mockResolvedValue({ history: [], unboundedHistoryCount: 0 }),
    };
    const runtime = makeSubagentRuntime({
      llmSource: { stream: vi.fn(async function* (params: LLMSourceParams): AsyncGenerator<InternalLLMChunk> {
        if (!native) { yield* progressing(); return; }
        for (let i = 0; i < 4; i++) {
          await new Promise<void>(resolve => setTimeout(resolve, 40));
          await params.onExternalAudit?.({ eventName: 'devin-cli-acp.tool', status: 'completed',
            data: { kalioSessionId: params.sessionId, turnId: params.turnId, toolCallId: `native-${i}`, toolStatus: 'completed' } });
        }
        yield { type: 'text_delta', delta: 'Native work complete.' }; yield { type: 'done' };
      }) },
      streamProcessor: { process: async (chunk, ctx) => {
        if (chunk.type === 'text_delta') {
          ctx.state.appendText(chunk.delta);
          ctx.emit('chat:chunk', { sessionId: ctx.sessionId, messageId: ctx.messageId, delta: chunk.delta, done: false });
        }
        if (chunk.type === 'done') await sessionManager.persistAssistantMessage(ctx.sessionId, ctx.messageId, ctx.state as TurnState);
      } },
      toolDispatch: { getToolMetas: vi.fn(() => []), dispatch: vi.fn() } as unknown as ToolDispatchService,
      sessionManager: sessionManager as unknown as SessionManagerService,
      sessions: { createWithId: vi.fn(async (id: string, dto: { parentSessionId?: string }) => ({ id, parentSessionId: dto.parentSessionId, personaId: 'default', title: 'child',
        kind: 'subagent', createdAt: 1, updatedAt: 1 } satisfies ChatSession)) } as unknown as SessionsService,
      vfs: { copySessionFiles: vi.fn(() => []) } as unknown as VFSService,
    });
    const outcome = runtime.runSubagent({ parentSessionId: 'parent', parentToolCallId: 'call', objective: 'work',
      availableTools: [], timeoutMs: 50, vfsMode: 'isolated', copyOutputs: false,
      ...(architecture ? { auditContext: { architectureRunId: 'architecture', roleSlotId: 'core', roleSlotType: 'tool_executor' } } : {}),
      ...(ui ? { emit: vi.fn() } : {}),
    }).then(() => ({ status: 'resolved' as const }), error => ({ status: 'rejected' as const, error }));
    await vi.advanceTimersByTimeAsync(220);
    const result = await outcome;
    expect(result.status).toBe(expected);
    if (result.status === 'rejected') expect(result.error).toMatchObject({ code: 'SUBAGENT_TIMEOUT' });
    expect(vi.getTimerCount()).toBe(0);
  });
});
