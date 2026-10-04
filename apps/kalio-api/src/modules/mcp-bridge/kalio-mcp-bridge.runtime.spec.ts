import { createServer } from 'node:http';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { ExecutionProfile } from '@kalio/types';
import * as schema from '../../database/schema';
import { DrizzleService } from '../../database/drizzle.service';
import { KalioMcpBridgeContextRegistry } from '../../common/kalio-mcp-bridge-context';
import { DevinCliAcpLLMSource } from '../agent-runtime/devin-cli-acp.llm-source';
import type { DevinAcpPromptInput } from '../agent-runtime/devin-cli-acp.host';
import { DrizzleMessageRepository } from '../chat/drizzle-message.repository';
import { SessionManagerService } from '../chat/session-manager.service';
import { ToolDispatchService } from '../chat/tool-dispatch.service';
import { ToolConfirmationService } from '../chat/tool-confirmation.service';
import { HitlRequestService } from '../hitl/hitl-request.service';
import { StreamProcessorService } from '../chat/stream-processor.service';
import { DoneHandler } from '../chat/handlers/done.handler';
import { TextDeltaHandler } from '../chat/handlers/text-delta.handler';
import { LLMTurnRuntimeService } from '../chat/llm-turn-runtime.service';
import type { EmitFn } from '../chat/interfaces/stream-context.interface';
import { KalioMcpBridgeService } from './kalio-mcp-bridge.service';

describe('managed ACP → MCP → durable chat runtime (SQLite)', () => {
  it.each(['approve', 'deny', 'transport_cancel', 'parent_stop'] as const)('settles %s with one authoritative tool trace', async (decision) => {
    const sqlite = new Database(':memory:');
    sqlite.exec(`CREATE TABLE messages (
      id TEXT PRIMARY KEY NOT NULL, session_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL,
      turn_id TEXT, prompt_message_id TEXT, thinking TEXT, tool_calls TEXT, tool_call_id TEXT,
      attachments TEXT, created_at INTEGER NOT NULL
    );
    CREATE TABLE hitl_requests (
      id TEXT PRIMARY KEY NOT NULL, kind TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
      session_id TEXT NOT NULL, turn_id TEXT, run_id TEXT, tool_call_id TEXT,
      payload TEXT NOT NULL, continuation TEXT, outcome TEXT, revision INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, resolved_at INTEGER
    );`);
    const database = new DrizzleService(null as never);
    (database as unknown as { db: unknown }).db = drizzle(sqlite, { schema });
    const repo = new DrizzleMessageRepository(database);
    const hitl = new HitlRequestService(database);
    const confirmations = new ToolConfirmationService(null, null, null, hitl);
    const parent = new AbortController();
    const downstream = new AbortController();
    let writes = 0;
    const dispatch = new ToolDispatchService([{
      meta: { name: 'fs_write', description: 'Counted fixture write', parameters: { type: 'object' }, requiresConfirmation: true },
      execute: async () => { writes++; return { saved: true }; },
    }], null, null, null, null, confirmations);
    const sessions = new SessionManagerService(repo, {} as never,
      { getContextWindowSize: async () => 32_000 } as never,
      { getNonReplayableTurnIds: async () => new Set() } as never);
    const processor = new StreamProcessorService([new DoneHandler(sessions), new TextDeltaHandler()], []);
    processor.onModuleInit();
    const contexts = new KalioMcpBridgeContextRegistry();
    const token = { getToken: async () => 'test-runtime-bridge-token' };
    let duplicateBridgeEmission = false;
    const bridge = new KalioMcpBridgeService(dispatch, token as never, contexts,
      { emitSessionEvent: () => { duplicateBridgeEmission = true; } } as never);
    const http = createServer((request, response) => {
      void bridge.handleRequest(request, response).catch((error: unknown) => {
        response.statusCode = 500;
        response.end(error instanceof Error ? error.message : String(error));
      });
    });
    const client = new Client({ name: 'managed-runtime-test', version: '1.0.0' });
    let ready!: () => void;
    const waiting = new Promise<void>((resolve) => { ready = resolve; });
    let requestId = '';
    const events: Array<{ event: string; data: unknown }> = [];
    const emit: EmitFn = (event, data) => {
      events.push({ event, data });
      if (event === 'tool:confirmation_required') {
        requestId = (data as { requestId: string }).requestId;
        queueMicrotask(ready);
      }
    };
    const profile: ExecutionProfile = {
      id: 'test-swe-2', name: 'Fixture Devin', kind: 'devin-cli-acp', model: 'swe-2',
      approvalMode: 'kalio_strict', enabled: true, capabilitiesVersion: '1', createdAt: 0, updatedAt: 0,
    };
    let run: Promise<unknown> | undefined;
    try {
      await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
      const address = http.address();
      if (!address || typeof address === 'string') throw new Error('No bridge listener');
      await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${address.port}/mcp`), {
        requestInit: { headers: {
          Authorization: 'Bearer test-runtime-bridge-token', 'x-kalio-session-id': 'composed-session',
          'x-kalio-bridge-client': 'devin-acp', 'x-kalio-tool-names': 'fs_write',
          'x-kalio-turn-id': 'stale-turn', 'x-kalio-prompt-message-id': 'stale-prompt',
        } },
      }));
      const source = new DevinCliAcpLLMSource({ get: async () => ({
        ensureSession: async () => ({ sessionId: 'fixture-acp', cwd: 'C:\\fixture', processEpoch: 'fixture-epoch', resumed: false }),
        prompt: async (_id: string, _text: string, input: DevinAcpPromptInput) => {
          const release = input.onTurnStart?.();
          try {
            const result = await client.callTool({ name: 'fs_write', arguments: { path: 'fixture.txt', content: 'demo' } }, undefined, {
              signal: downstream.signal, resetTimeoutOnProgress: true, onprogress: () => undefined,
            });
            input.onText(result.isError ? 'Declined' : 'Saved');
            return 'end_turn' as const;
          } finally { release?.(); }
        },
      }) } as never, { get: async () => ({ filesystem: false, web: false, terminal: false, source: 'settings' }) } as never,
      token as never, contexts);
      const runtime = new LLMTurnRuntimeService(source, processor, sessions, dispatch);
      run = runtime.runAgentLoop({
        runtimeKind: 'chat', sessionId: 'composed-session', runId: 'composed-run', turnId: 'composed-turn',
        promptMessageId: 'composed-prompt', personaId: 'fixture', effectiveSystemPrompt: 'Fixture',
        toolMetas: dispatch.getToolMetas(), abortSignal: parent.signal, emit, maxIterations: 1,
        providerCompletesTurn: true, executionProfile: profile,
      });
      // Observe errors immediately while approval readiness is pending.
      const observed = run.then((value) => ({ value, error: undefined }), (error: unknown) => ({ value: undefined, error }));
      await Promise.race([waiting, observed]);
      expect(writes).toBe(0);
      const before = await repo.loadHistory('composed-session');
      expect(before).toEqual([expect.objectContaining({
        role: 'assistant', turnId: 'composed-turn', promptMessageId: 'composed-prompt',
        toolCalls: [expect.objectContaining({ name: 'fs_write' })],
      })]);
      if (decision === 'approve') await dispatch.resolveConfirmation(requestId, 'composed-session');
      else if (decision === 'deny') await dispatch.cancelConfirmation(requestId, 'composed-session');
      else if (decision === 'transport_cancel') downstream.abort();
      else parent.abort();
      const outcome = await observed;
      if (decision === 'transport_cancel') expect(outcome.error).toBeInstanceOf(Error);
      else expect(outcome.error).toBeUndefined();
      expect(writes).toBe(decision === 'approve' ? 1 : 0);
      expect(contexts.get('composed-session')).toBeUndefined();
      expect(dispatch.getPendingConfirmations('composed-session')).toEqual([]);
      expect(duplicateBridgeEmission).toBe(false);
      const restored = await repo.loadHistory('composed-session');
      const results = restored.filter((message) => message.role === 'tool_result');
      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({ turnId: 'composed-turn', promptMessageId: 'composed-prompt' });
      expect(JSON.parse(results[0]!.content)).toMatchObject(decision === 'approve' ? { saved: true } : { status: 'cancelled' });
      expect(events.filter(({ event }) => event === 'tool:start')).toHaveLength(1);
      expect(events.filter(({ event }) => event === 'tool:result')).toHaveLength(1);
    } finally {
      parent.abort(); downstream.abort();
      await client.close();
      await run?.catch((error: unknown) => { if (!(error instanceof Error)) throw error; });
      await bridge.close();
      await new Promise<void>((resolve, reject) => http.close((error) => error ? reject(error) : resolve()));
      sqlite.close();
    }
  });
});
