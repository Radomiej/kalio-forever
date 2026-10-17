import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { describe, expect, it, vi } from 'vitest';
import type { DrizzleService } from '../../../database/drizzle.service';
import { AuditService } from '../audit.service';
import type { InternalLLMChunk, UsageChunk } from '../interfaces/llm-chunk.types';
import type { ILLMSource } from '../interfaces/llm-source.interface';
import type { StreamContext } from '../interfaces/stream-context.interface';
import { LLMTurnRuntimeService } from '../llm-turn-runtime.service';
import { RuntimeAuditLogger } from '../runtime-audit-logger.service';
import type { SessionManagerService } from '../session-manager.service';
import type { StreamProcessorService } from '../stream-processor.service';
import type { ToolDispatchService } from '../tool-dispatch.service';

const usageCases: Array<{ name: string; chunk?: UsageChunk; expected?: Record<string, number> }> = [
  { name: 'absent usage' },
  { name: 'usage without total', chunk: { type: 'usage', promptTokens: 10, completionTokens: 4 },
    expected: { promptTokens: 10, completionTokens: 4 } },
  { name: 'complete usage', chunk: { type: 'usage', promptTokens: 10, completionTokens: 4, totalTokens: 14 },
    expected: { promptTokens: 10, completionTokens: 4, totalTokens: 14 } },
];

describe('runtime response audit persistence (real AuditService and SQLite)', () => {
  for (const runtimeKind of ['chat', 'subagent'] as const) {
    it.each(usageCases)(`${runtimeKind} persists final metrics with $name`, async ({ chunk, expected }) => {
      const client = new Database(':memory:');
      const db = drizzle(client);
      client.exec(`CREATE TABLE audit_log (id TEXT PRIMARY KEY, session_id TEXT, type TEXT NOT NULL,
        label TEXT NOT NULL, data TEXT, duration_ms INTEGER, chunk_count INTEGER, created_at INTEGER NOT NULL);
        CREATE TABLE audit_log_archive (id TEXT PRIMARY KEY, session_id TEXT, type TEXT NOT NULL,
        label TEXT NOT NULL, data TEXT, duration_ms INTEGER, chunk_count INTEGER, created_at INTEGER NOT NULL,
        archived_at INTEGER NOT NULL);`);
      const audit = new AuditService({ db } as unknown as DrizzleService);
      try {
        // Initialize the real retention clock before streaming so background retention is not pending at close.
        await audit.runRetentionNow();
        const llmSource: ILLMSource = {
          async *stream(): AsyncIterable<InternalLLMChunk> {
            yield { type: 'text_delta', delta: 'Stored answer' };
            yield { type: 'thinking_delta', delta: 'Reasoning' };
            if (chunk) yield chunk;
            yield { type: 'done' };
          },
        };
        const sessionManager = {
          loadHistoryForLLM: vi.fn().mockResolvedValue({ history: [], unboundedHistoryCount: 0 }),
        } satisfies Pick<SessionManagerService, 'loadHistoryForLLM'>;
        const processor = {
          async process(value: InternalLLMChunk, context: StreamContext): Promise<void> {
            if (value.type === 'text_delta') context.state.appendText(value.delta);
            if (value.type === 'thinking_delta') context.state.appendThinking(value.delta);
          },
        } satisfies Pick<StreamProcessorService, 'process'>;
        const runtime = new LLMTurnRuntimeService(
          llmSource, processor as unknown as StreamProcessorService,
          sessionManager as unknown as SessionManagerService,
          { dispatch: vi.fn() } as unknown as ToolDispatchService,
          audit, new RuntimeAuditLogger(audit),
        );
        await runtime.runAgentLoop({
          runtimeKind, sessionId: 'session', turnId: 'turn', promptMessageId: 'prompt',
          personaId: 'default', effectiveSystemPrompt: 'fixture', toolMetas: [],
          ...(runtimeKind === 'subagent' ? { agentRun: { agentRunId: 'child', agentType: 'subagent' as const,
            parentSessionId: 'parent', parentToolCallId: 'parent-call' } } : {}),
          abortSignal: new AbortController().signal, emit: vi.fn(), maxIterations: 1,
        });

        const rows = await audit.listEntries({ sessionId: 'session', types: ['llm_response'], source: 'hot', limit: 10 });
        expect(rows).toHaveLength(1);
        const row = rows[0]!;
        expect(row.durationMs).toEqual(expect.any(Number));
        expect(row.durationMs).toBeGreaterThanOrEqual(0);
        expect(row.chunkCount).toBe(3);
        expect(row.data).toMatchObject({ iteration: 1, textLength: 13, thinkingLength: 9, toolCallCount: 0 });
        expect(row.data?.['estimatedOutputTokens']).toBeGreaterThan(0);
        if (expected) expect(row.data?.['usage']).toEqual(expected);
        else expect(row.data).not.toHaveProperty('usage');
        if (runtimeKind === 'subagent') expect(row.data).toMatchObject({ domain: 'subagent', childAgentRunId: 'child' });
        const completed = await audit.listEntries({ sessionId: 'session', types: ['runtime_event'], source: 'hot', limit: 10 });
        expect(completed.find(entry => entry.label === 'llm.turn.completed')?.data).toMatchObject({ status: 'completed' });
      } finally {
        audit.onModuleDestroy();
        client.close();
      }
    });
  }
});
