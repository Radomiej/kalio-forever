import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { expect, it, vi } from 'vitest';
import type { ToolResult } from '@kalio/types';
import * as schema from '../../../database/schema';
import type { DrizzleService } from '../../../database/drizzle.service';
import { AuditService } from '../audit.service';
import { DrizzleMessageRepository } from '../drizzle-message.repository';
import { DoneHandler } from '../handlers/done.handler';
import { ToolCallHandler } from '../handlers/tool-call.handler';
import type { ILLMSource } from '../interfaces/llm-source.interface';
import { LLMTurnRuntimeService } from '../llm-turn-runtime.service';
import { SessionEventsService } from '../session-events.service';
import { SessionManagerService } from '../session-manager.service';
import { StreamProcessorService } from '../stream-processor.service';
import { ToolDispatchService } from '../tool-dispatch.service';
import { createMessageSessions } from './message-session.fixture';

it.each([1, 2])('records exactly one execution, live event and hydrated result per genuine fs_read (%i calls)', async reads => {
  const client = new Database(':memory:');
  client.exec(`CREATE TABLE messages (id TEXT PRIMARY KEY, session_id TEXT, role TEXT, content TEXT,
    turn_id TEXT, prompt_message_id TEXT, thinking TEXT, tool_calls TEXT, tool_call_id TEXT,
    attachments TEXT, created_at INTEGER);
    CREATE TABLE audit_log (id TEXT PRIMARY KEY, session_id TEXT, type TEXT, label TEXT, data TEXT,
    duration_ms INTEGER, chunk_count INTEGER, created_at INTEGER);
    CREATE TABLE audit_log_archive (id TEXT PRIMARY KEY, session_id TEXT, type TEXT, label TEXT, data TEXT,
    duration_ms INTEGER, chunk_count INTEGER, created_at INTEGER, archived_at INTEGER);`);
  createMessageSessions(client, ['session']);
  const database = { db: drizzle(client, { schema }) } as unknown as DrizzleService;
  const audit = new AuditService(database);
  try {
    await audit.runRetentionNow();
    const repo = new DrizzleMessageRepository(database, new SessionEventsService());
    const sessions = new SessionManagerService(repo, {} as never,
      { getContextWindowSize: async () => 32_000 } as never,
      { getNonReplayableTurnIds: async () => new Set() } as never);
    const processor = new StreamProcessorService([new DoneHandler(sessions), new ToolCallHandler()], []);
    processor.onModuleInit();
    const data = { path: 'harness/tests/example.test', content: '# first\n# second\n', lines: 3 };
    const execute = vi.fn(async () => data);
    const dispatcher = new ToolDispatchService([{
      meta: { name: 'fs_read', description: 'read', parameters: {}, requiresConfirmation: false }, execute,
    }], null, null, null, null);
    const delivered: ToolResult[] = [];
    const source: ILLMSource = {
      async *stream(params) {
        params.toolResultChannel!.setHandler((_id, result) => { delivered.push(result); });
        for (let i = 0; i < reads; i++) {
          yield { type: 'tool_call', callId: `read-${i}`, name: 'fs_read', args: { path: data.path } };
        }
        yield { type: 'done' };
      },
    };
    const emit = vi.fn();
    await new LLMTurnRuntimeService(source, processor, sessions, dispatcher, audit).runAgentLoop({
      runtimeKind: 'chat', sessionId: 'session', turnId: 'turn', promptMessageId: 'prompt',
      firstMessageId: 'answer', personaId: 'default', effectiveSystemPrompt: 'Count cases',
      toolMetas: dispatcher.getToolMetas(), abortSignal: new AbortController().signal,
      emit, maxIterations: 1, providerCompletesTurn: true,
    });
    expect(execute).toHaveBeenCalledTimes(reads);
    for (const event of ['tool:start', 'tool:result']) {
      expect(emit.mock.calls.filter(([name]) => name === event)).toHaveLength(reads);
    }
    expect(delivered).toHaveLength(reads);
    expect(delivered[0]).toMatchObject({ status: 'success', data });
    const history = await repo.loadHistory('session');
    expect(history.find(message => message.role === 'assistant')?.toolCalls).toHaveLength(reads);
    const results = history.filter(message => message.role === 'tool_result');
    expect(results).toHaveLength(reads);
    expect(JSON.parse(results[0]!.content)).toEqual(data);
    for (const type of ['tool_call', 'tool_result']) {
      expect(client.prepare('SELECT id FROM audit_log WHERE type=?').all(type)).toHaveLength(reads);
    }
  } finally {
    audit.onModuleDestroy();
    client.close();
  }
});
