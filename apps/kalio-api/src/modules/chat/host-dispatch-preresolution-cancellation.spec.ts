import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HostHitlExecutionCommit, HostRuntimeToolCommit, ToolResult } from '@kalio/types';
import * as schema from '../../database/schema';
import type { DrizzleService } from '../../database/drizzle.service';
import type { MCPService } from '../mcp/mcp.service';
import { HitlRequestService } from '../hitl/hitl-request.service';
import { HostDispatchReceiptService } from './host-dispatch-receipt.service';
import { PersistedRuntimeEvidenceReader } from './persisted-runtime-evidence-reader';
import { ToolConfirmationService } from './tool-confirmation.service';
import { ToolDispatchService } from './tool-dispatch.service';
import { TurnState } from './turn-state';
import { serializeToolResultContent } from './llm-turn-tool-execution';

const databases: Database.Database[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });

async function fixture() {
  const client = new Database(':memory:'); databases.push(client);
  client.exec(readFileSync(join(__dirname, '../../database/migrations/0037_host_dispatch_receipts.sql'), 'utf8'));
  client.exec(`CREATE TABLE messages (id TEXT PRIMARY KEY,session_id TEXT,role TEXT,content TEXT,turn_id TEXT,prompt_message_id TEXT,tool_call_id TEXT,created_at INTEGER);
    CREATE TABLE chat_runs (id TEXT PRIMARY KEY,session_id TEXT,turn_id TEXT,revision INTEGER);
    CREATE TABLE hitl_requests (id TEXT PRIMARY KEY,kind TEXT,status TEXT DEFAULT 'pending',session_id TEXT,turn_id TEXT,run_id TEXT,tool_call_id TEXT,
      payload TEXT,continuation TEXT,outcome TEXT,revision INTEGER DEFAULT 1,created_at INTEGER,updated_at INTEGER,resolved_at INTEGER);
    INSERT INTO chat_runs VALUES ('r','s','t',1); INSERT INTO messages VALUES ('p','s','user','test','t','p',NULL,1);`);
  const provider = { db: drizzle(client, { schema }) } as unknown as DrizzleService;
  const requests = new HitlRequestService(provider);
  const confirmations = new ToolConfirmationService(null, null, null, requests);
  const entry = { meta: { name: 'terminal_spawn', description: '', parameters: {}, requiresConfirmation: true },
    catalogEntryId: 'catalog.spawn', executorImplementationId: 'executor.spawn', executorImplementationVersion: 1,
    execute: vi.fn(async () => ({ terminalId: 'never-entered' })) };
  const mcp = { getAllTools: () => [], resolveToolName: () => null } as unknown as MCPService;
  const create = () => new HostDispatchReceiptService(provider, [entry], new PersistedRuntimeEvidenceReader(provider), mcp);
  const identity = { runId: 'r', sessionId: 's', turnId: 't', promptMessageId: 'p' };
  const execution = new AbortController();
  // Explicit independent fixture lifetime: this tests the payload/authority boundary,
  // NOT production persistence with an already-aborted execution signal or Stop drain.
  const recording = new AbortController();
  const call = create().recorder.createCallRecorder({ identity, callId: 'c', toolName: 'terminal_spawn', args: {} }, recording.signal);
  let ack: ((result: ToolResult) => Promise<HostHitlExecutionCommit>) | undefined;
  const resolved = vi.fn(call.resolved);
  const entered = vi.fn();
  const dispatcher = new ToolDispatchService([entry], null, null, null, null, confirmations);
  const pending = dispatcher.dispatch('c', 'terminal_spawn', {}, { ...identity, messageId: 'assistant', state: new TurnState(),
    emit: vi.fn(), abortSignal: execution.signal, onResolvedToolDispatch: resolved, onToolExecutorEntered: entered,
    registerToolResultReceiptCommit: value => { ack = value; }, markToolRunning: async () => { execution.abort('fixture execution Stop'); },
  });
  let requestId = '';
  await vi.waitFor(() => { const rows = confirmations.getPendingConfirmations('s'); expect(rows).toHaveLength(1); requestId = rows[0]!.requestId; });
  expect(await confirmations.resolveConfirmation(requestId, 's')).toBe('resolved');
  const result = await pending;
  expect(result.status).toBe('cancelled'); expect(entry.execute).not.toHaveBeenCalled();
  expect(resolved).not.toHaveBeenCalled(); expect(entered).not.toHaveBeenCalled();
  if (!ack) throw new Error('fixture missing actual registered ACK');
  const content = serializeToolResultContent('terminal_spawn', result);
  client.prepare('INSERT INTO messages VALUES (?,?,?,?,?,?,?,?)').run('result', 's', 'tool_result', content, 't', 'p', 'c', 2);
  const hitlCommit = await ack(result);
  const receipt: HostRuntimeToolCommit = { identity, callId: 'c', toolName: 'terminal_spawn', persistedMessageId: 'result',
    contentSha256: createHash('sha256').update(content).digest('hex'), status: result.status, registeredCommitAck: 'acknowledged',
    resolvedDispatch: null, hitlCommit };
  return { client, create, call, receipt, identity, hitlCommit, requestId, recording };
}

describe('pre-resolution claimed HITL cancellation (real SQLite + dispatch)', () => {
  it('retains exact actual claim commit without inventing approval, canonical name or entry', async () => {
    const f = await fixture(); await f.call.commit(f.receipt);
    const stored = await f.create().recorder.readExact({ ...f.identity, callId: 'c' });
    expect(stored?.payload).toMatchObject({ canonicalName: null, approval: null, enteredTarget: null,
      hitlCommit: f.hitlCommit, registeredCommitAck: 'acknowledged', result: { status: 'cancelled' } });
    const facts = await f.create().readDispatchFactsExact(f.identity, 'c');
    expect(facts).toMatchObject({ canonicalName: null, approval: null, target: null, hitlCommit: f.hitlCommit, resultStatus: 'cancelled' });
    expect(facts).not.toHaveProperty('build'); expect(facts).not.toHaveProperty('evidence');
  });

  it.each(['success', 'error'] as const)('rejects null-entry %s', async status => {
    const f = await fixture();
    await expect(f.call.commit({ ...f.receipt, status, hitlCommit: { ...f.hitlCommit, resultStatus: status } })).rejects.toThrow('HOST_DISPATCH_RECEIPT_INVALID');
  });

  it.each(['session_id', 'turn_id', 'run_id', 'tool_call_id'] as const)('rejects foreign durable %s', async field => {
    const f = await fixture(); f.client.prepare(`UPDATE hitl_requests SET ${field}='foreign' WHERE id=?`).run(f.requestId);
    await expect(f.call.commit(f.receipt)).rejects.toThrow('HOST_DISPATCH_RECEIPT_AUTHORITY');
  });

  it('rejects forged candidate claim revision and missing ACK', async () => {
    const f = await fixture();
    await expect(f.call.commit({ ...f.receipt, hitlCommit: { ...f.hitlCommit, claimedRevision: f.hitlCommit.claimedRevision - 1 } })).rejects.toThrow('HOST_DISPATCH_RECEIPT_AUTHORITY');
    const g = await fixture();
    await expect(g.call.commit({ ...g.receipt, registeredCommitAck: 'not_registered' })).rejects.toThrow('HOST_DISPATCH_RECEIPT_INVALID');
  });

  it('revalidates persisted host execution commit after recorder recreation', async () => {
    const f = await fixture(); await f.call.commit(f.receipt);
    const row = await new HitlRequestService({ db: drizzle(f.client, { schema }) } as unknown as DrizzleService).getById(f.requestId);
    f.client.prepare('UPDATE hitl_requests SET continuation=? WHERE id=?').run(JSON.stringify({ ...row?.continuation, hostExecutionCommit: undefined }), f.requestId);
    await expect(f.create().recorder.readExact({ ...f.identity, callId: 'c' })).rejects.toThrow('HOST_DISPATCH_RECEIPT_AUTHORITY');
  });

  it('does not bypass an aborted recording lifetime or disclose its reason', async () => {
    const f = await fixture(); f.recording.abort('SECRET_CUSTOM_ABORT');
    await expect(f.call.commit(f.receipt)).rejects.toThrow(/^HOST_DISPATCH_RECEIPT_ABORTED$/);
    expect(f.client.prepare('SELECT COUNT(*) AS n FROM host_dispatch_receipts').get()).toEqual({ n: 0 });
  });

  it.each(['revision', 'prompt', 'outcome', 'tool', 'result_scope', 'result_bytes'] as const)('rejects durable %s drift', async field => {
    const f = await fixture();
    if (field === 'revision') f.client.exec('UPDATE hitl_requests SET revision=99');
    else if (field === 'prompt') f.client.exec("UPDATE hitl_requests SET continuation=json_set(continuation,'$.promptMessageId','foreign')");
    else if (field === 'outcome') f.client.exec("UPDATE hitl_requests SET outcome=json_set(outcome,'$.status','success')");
    else if (field === 'tool') f.client.exec("UPDATE hitl_requests SET payload=json_set(payload,'$.toolName','foreign')");
    else if (field === 'result_scope') f.client.exec("UPDATE messages SET tool_call_id='foreign' WHERE id='result'");
    else f.client.exec("UPDATE messages SET content='changed' WHERE id='result'");
    await expect(f.call.commit(f.receipt)).rejects.toThrow('HOST_DISPATCH_RECEIPT_AUTHORITY');
    expect(f.client.prepare('SELECT COUNT(*) AS n FROM host_dispatch_receipts').get()).toEqual({ n: 0 });
  });
});
