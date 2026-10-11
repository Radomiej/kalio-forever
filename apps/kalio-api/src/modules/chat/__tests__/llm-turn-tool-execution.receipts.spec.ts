import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HostRuntimeToolCommit, HostResolvedToolDispatch } from '@kalio/types';
import * as schema from '../../../database/schema';
import { DrizzleService } from '../../../database/drizzle.service';
import { HitlRequestService } from '../../hitl/hitl-request.service';
import { ToolConfirmationService } from '../tool-confirmation.service';
import { ToolDispatchService } from '../tool-dispatch.service';
import { dispatchRuntimeTool, TurnExecutionLane } from '../llm-turn-tool-execution';
import { TurnState } from '../turn-state';
import type { SessionManagerService } from '../session-manager.service';
import type { StreamContext } from '../interfaces/stream-context.interface';
import type { LLMAgentLoopRequest } from '../llm-turn-runtime.types';

const databases: Database.Database[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });

function fixture(mode: 'manual' | 'unknown' | 'gate_failure' | 'abort_gate' | 'save_failure' | 'ack_failure' = 'manual') {
  const sqlite = new Database(':memory:'); databases.push(sqlite);
  sqlite.exec(`CREATE TABLE hitl_requests (
    id text PRIMARY KEY NOT NULL, kind text NOT NULL, status text NOT NULL DEFAULT 'pending',
    session_id text NOT NULL, turn_id text, run_id text, tool_call_id text,
    payload text NOT NULL, continuation text, outcome text, revision integer NOT NULL DEFAULT 1,
    created_at integer NOT NULL, updated_at integer NOT NULL, resolved_at integer
  ); CREATE TABLE saved_results (id text PRIMARY KEY, content text NOT NULL);`);
  const database = new DrizzleService(null as never);
  (database as unknown as { db: unknown }).db = drizzle(sqlite, { schema });
  const requests = new HitlRequestService(database);
  const confirmations = new ToolConfirmationService(null, null, null, requests);
  const order: string[] = [];
  const controller = new AbortController();
  const dispatches: HostResolvedToolDispatch[] = [];
  const receipts: HostRuntimeToolCommit[] = [];
  const observer = {
    admit: async () => { order.push('admit'); },
    resolvedDispatch: async (value: HostResolvedToolDispatch) => {
      dispatches.push(value); order.push('resolved');
      if (mode === 'gate_failure') throw new Error('host rejected');
      if (mode === 'abort_gate') controller.abort();
    },
    commit: async (value: HostRuntimeToolCommit) => {
      order.push('commit'); receipts.push(value);
      const row = await requests.getById(value.hitlCommit?.requestId ?? 'absent');
      if (value.hitlCommit) expect(row).toMatchObject({ revision: value.hitlCommit.committedRevision,
        continuation: { executionState: 'tool_result_committed' } });
    }, drain: async () => undefined, journalComplete: async () => undefined,
  };
  const entry = { meta: { name: 'terminal_spawn', description: '', parameters: {}, requiresConfirmation: true },
    execute: async () => { order.push('execute'); return { text: 'Zażółć 🧪' }; } };
  const toolDispatch = new ToolDispatchService([entry], null, null, null, null, confirmations);
  const sessionManager = { saveToolResult: async (_session: string, _call: string, content: string) => {
    order.push('save');
    if (mode === 'save_failure') throw new Error('save rejected');
    sqlite.prepare('INSERT INTO saved_results VALUES (?, ?)').run('result-message', content);
    if (mode === 'ack_failure') sqlite.exec("UPDATE hitl_requests SET revision = 99");
    return 'result-message';
  } } as unknown as SessionManagerService;
  const context: StreamContext = { sessionId: 'session', runId: 'journal', turnId: 'turn', promptMessageId: 'prompt',
    messageId: 'assistant', state: new TurnState(), emit: () => undefined, abortSignal: controller.signal };
  const request: LLMAgentLoopRequest = { sessionId: 'session', runId: 'journal', turnId: 'turn', promptMessageId: 'prompt',
    emit: context.emit, abortSignal: controller.signal, runtimeKind: 'chat', personaId: 'persona',
    effectiveSystemPrompt: '', maxIterations: 1, toolMetas: toolDispatch.getToolMetas(), hostRuntimeReceiptObserver: observer };
  const call = { id: 'call', name: mode === 'unknown' ? 'unknown' : 'terminal_spawn', args: { command: 'npm',
    resolvedDispatch: { approval: { kind: 'durable_confirmation', requestId: 'forged' } } } };
  const run = () => dispatchRuntimeTool({ request, call, context, lane: new TurnExecutionLane(), sessionManager, toolDispatch });
  const approve = async () => {
    let id = '';
    await vi.waitFor(async () => { const pending = confirmations.getPendingConfirmations('session');
      expect(pending).toHaveLength(1); id = pending[0]!.requestId; });
    expect(await confirmations.resolveConfirmation(id, 'session')).toBe('resolved');
    return id;
  };
  return { run, approve, requests, sqlite, order, dispatches, receipts, entry };
}

describe('runtime resolved-dispatch + durable HITL receipts (real SQLite)', () => {
  it('persists the result before required HITL ACK and emits both actual receipts', async () => {
    const f = fixture(); const pending = f.run(); const id = await f.approve(); await pending;
    expect(f.order).toEqual(['admit', 'resolved', 'execute', 'save', 'commit']);
    expect(f.receipts[0]?.resolvedDispatch).toBe(f.dispatches[0]);
    expect(f.receipts[0]?.hitlCommit).toEqual({ requestId: id, claimedRevision: 3, committedRevision: 4,
      status: 'approved', executionState: 'tool_result_committed', resultStatus: 'success' });
    expect(f.dispatches[0]?.approval).toEqual({ kind: 'durable_confirmation', requestId: id, claimedRevision: 3 });
    expect(f.dispatches[0]?.target).toMatchObject({ kind: 'kalio_registry', entryIdentity: f.entry, executorIdentity: f.entry.execute });
    expect(f.receipts[0]?.hitlCommit?.requestId).not.toBe('forged');
    expect(f.sqlite.prepare('SELECT content FROM saved_results').get()).toEqual({ content: '{"text":"Zażółć 🧪"}' });
  });

  it('persists attempted unknown calls without elevating them into execution or HITL proof', async () => {
    const f = fixture('unknown'); expect((await f.run()).status).toBe('error');
    expect(f.dispatches).toEqual([]);
    expect(f.receipts[0]).toMatchObject({ resolvedDispatch: null, hitlCommit: null, registeredCommitAck: 'not_registered' });
    expect(f.order).toEqual(['admit', 'save', 'commit']);
  });

  it.each(['gate_failure', 'save_failure', 'ack_failure'] as const)('fails closed on %s without observer commit', async mode => {
    const f = fixture(mode); const run = f.run();
    const failure = expect(run).rejects.toThrow(mode === 'ack_failure' ? 'HITL_EXECUTION_COMMIT_FAILED' : 'rejected');
    await f.approve(); await failure;
    expect(f.receipts).toEqual([]);
    expect(f.order.includes('execute')).toBe(mode !== 'gate_failure');
    const count = f.sqlite.prepare('SELECT COUNT(*) AS n FROM saved_results').get();
    expect(count).toEqual({ n: mode === 'ack_failure' ? 1 : 0 });
  });

  it('does not claim execution after abort in the host gate', async () => {
    const f = fixture('abort_gate'); const run = f.run(); await f.approve(); expect((await run).status).toBe('cancelled');
    expect(f.order).not.toContain('execute');
    expect(f.receipts[0]?.resolvedDispatch).toBeNull();
  });
});
