import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { describe, expect, it, afterEach } from 'vitest';
import { DrizzleService } from '../../database/drizzle.service';
import * as schema from '../../database/schema';
import { HitlRequestService } from './hitl-request.service';

const databases: Database.Database[] = [];
afterEach(() => { for (const database of databases.splice(0)) database.close(); });

function makeFixture() {
  const sqlite = new Database(':memory:');
  databases.push(sqlite);
  sqlite.exec(`CREATE TABLE hitl_requests (
    id text PRIMARY KEY NOT NULL, kind text NOT NULL, status text NOT NULL DEFAULT 'pending',
    session_id text NOT NULL, turn_id text, run_id text, tool_call_id text,
    payload text NOT NULL, continuation text, outcome text, revision integer NOT NULL DEFAULT 1,
    created_at integer NOT NULL, updated_at integer NOT NULL, resolved_at integer
  );`);
  const drizzleService = new DrizzleService(null as never);
  (drizzleService as unknown as { db: unknown }).db = drizzle(sqlite, { schema });
  return { service: new HitlRequestService(drizzleService), sqlite };
}
function makeService(): HitlRequestService { return makeFixture().service; }

async function claimedFixture() {
  const fixture = makeFixture();
  await fixture.service.create({ id: 'receipt', kind: 'tool_confirmation', sessionId: 's', payload: {}, continuation: { executionState: 'pending' } });
  await fixture.service.resolve('receipt', 1, 'approved');
  await fixture.service.claimApprovedContinuation('receipt', 2);
  return fixture;
}
async function claimedHostFixture() {
  const fixture = makeFixture();
  await fixture.service.create({ id: 'host-receipt', kind: 'tool_confirmation', sessionId: 'host', turnId: 'turn', runId: 'run', toolCallId: 'call',
    payload: { toolName: 'terminal_spawn', args: { command: 'not-executed' } }, continuation: {
      sessionId: 'host', turnId: 'turn', runId: 'run', promptMessageId: 'prompt', executionState: 'pending',
      hostConfirmationRequirement: { kind: 'human_only', toolName: 'terminal_spawn', callId: 'call' },
    } });
  expect(await fixture.service.resolveHostConfirmationFromGateway('host-receipt', 1, 'host', 'socket')).toBe(true);
  expect(await fixture.service.claimApprovedHostContinuation('host-receipt', 2, 'host', 'call')).toMatchObject({ revision: 3 });
  return fixture;
}

describe('HitlRequestService', () => {
  it.each(['success', 'error', 'cancelled'] as const)('persists exact host commit with full identity and result %s', async status => {
    const { service } = await claimedHostFixture(); const before = await service.getById('host-receipt');
    const commit = await service.markContinuationToolResultRequired('host-receipt', 3, { status });
    expect(commit).toEqual({ requestId: 'host-receipt', claimedRevision: 3, committedRevision: 4,
      status: 'approved', executionState: 'tool_result_committed', resultStatus: status });
    const after = await service.getById('host-receipt');
    expect(after).toMatchObject({ sessionId: 'host', turnId: 'turn', runId: 'run', toolCallId: 'call', revision: 4, status: 'approved',
      outcome: { status }, continuation: { ...before!.continuation, executionState: 'tool_result_committed', hostExecutionCommit: commit } });
  });
  it.each(['session_id', 'turn_id', 'run_id', 'tool_call_id', 'status', 'revision'] as const)('rolls back host commit if final readback changes %s', async field => {
    const { service, sqlite } = await claimedHostFixture(); const before = await service.getById('host-receipt');
    // Controlled fixture identifiers only, never caller input.
    const value = field === 'revision' ? '99' : "'changed'";
    sqlite.exec(`CREATE TRIGGER corrupt_host_commit AFTER UPDATE OF continuation ON hitl_requests
      WHEN json_type(NEW.continuation, '$.hostExecutionCommit') = 'object'
      BEGIN UPDATE hitl_requests SET ${field} = ${value} WHERE id = NEW.id; END;`);
    await expect(service.markContinuationToolResultRequired('host-receipt', 3, { status: 'success' })).rejects.toThrow(/^HITL_EXECUTION_COMMIT_FAILED$/);
    expect(await service.getById('host-receipt')).toEqual(before);
  });
  it('rolls back host prompt identity corruption in the initial state commit', async () => {
    const { service, sqlite } = await claimedHostFixture(); const before = await service.getById('host-receipt');
    sqlite.exec(`CREATE TRIGGER corrupt_prompt AFTER UPDATE OF outcome ON hitl_requests
      BEGIN UPDATE hitl_requests SET continuation = json_set(NEW.continuation, '$.promptMessageId', 'foreign') WHERE id = NEW.id; END;`);
    await expect(service.markContinuationToolResultRequired('host-receipt', 3, { status: 'success' })).rejects.toThrow(/^HITL_EXECUTION_COMMIT_FAILED$/);
    expect(await service.getById('host-receipt')).toEqual(before);
  });
  it('durably persists the exact returned required commit for a fresh service reader', async () => {
    const { service, sqlite } = await claimedFixture();
    sqlite.exec(`CREATE TRIGGER actual_commit_revision AFTER UPDATE OF outcome ON hitl_requests
      BEGIN UPDATE hitl_requests SET revision = 17 WHERE id = NEW.id; END;`);
    const commit = await service.markContinuationToolResultRequired('receipt', 3, { status: 'success' });
    const raw = sqlite.prepare('SELECT continuation, revision, status, outcome FROM hitl_requests WHERE id = ?').get('receipt') as {
      continuation: string; revision: number; status: string; outcome: string;
    };
    expect(JSON.parse(raw.continuation).hostExecutionCommit).toEqual(commit);
    expect(commit).toEqual({ requestId: 'receipt', claimedRevision: 3, committedRevision: 17,
      status: 'approved', executionState: 'tool_result_committed', resultStatus: 'success' });
    expect(raw.revision).toBe(17); expect(raw.status).toBe('approved'); expect(JSON.parse(raw.outcome)).toEqual({ status: 'success' });
    const restartedDrizzle = new DrizzleService(null as never);
    (restartedDrizzle as unknown as { db: unknown }).db = drizzle(sqlite, { schema });
    expect((await new HitlRequestService(restartedDrizzle).getById('receipt'))?.continuation?.['hostExecutionCommit']).toEqual(commit);
  });
  it('rolls back if SQLite alters the persisted required commit', async () => {
    const { service, sqlite } = await claimedFixture();
    sqlite.exec(`CREATE TRIGGER corrupt_commit AFTER UPDATE OF continuation ON hitl_requests
      WHEN json_type(NEW.continuation, '$.hostExecutionCommit') = 'object'
      BEGIN UPDATE hitl_requests SET continuation = json_set(NEW.continuation, '$.hostExecutionCommit.claimedRevision', 99) WHERE id = NEW.id; END;`);
    await expect(service.markContinuationToolResultRequired('receipt', 3, { status: 'success' })).rejects.toThrow('HITL_EXECUTION_COMMIT_FAILED');
    expect(await service.getById('receipt')).toMatchObject({ revision: 3, status: 'approved', outcome: null, continuation: { executionState: 'claimed' } });
  });
  it('reads the actual revision after a SQLite trigger rather than inferring claimed + 1', async () => {
    const { service, sqlite } = await claimedFixture();
    sqlite.exec(`CREATE TRIGGER bump_receipt AFTER UPDATE OF outcome ON hitl_requests
      BEGIN UPDATE hitl_requests SET revision = 17 WHERE id = NEW.id; END;`);
    const receipt = await service.markContinuationToolResultRequired('receipt', 3, { status: 'error' });
    expect(receipt.committedRevision).toBe(17);
    expect(await service.getById('receipt')).toMatchObject({ revision: 17, outcome: { status: 'error' } });
  });

  it('rolls back the CAS when same-transaction readback no longer matches the committed state', async () => {
    const { service, sqlite } = await claimedFixture();
    sqlite.exec(`CREATE TRIGGER corrupt_receipt AFTER UPDATE OF outcome ON hitl_requests
      BEGIN UPDATE hitl_requests SET status = 'denied' WHERE id = NEW.id; END;`);
    await expect(service.markContinuationToolResultRequired('receipt', 3, { status: 'success' })).rejects.toThrow('HITL_EXECUTION_COMMIT_FAILED');
    expect(await service.getById('receipt')).toMatchObject({ revision: 3, status: 'approved', outcome: null,
      continuation: { executionState: 'claimed' } });
  });

  it('allows only one of two stale required commits and returns no invented ACK', async () => {
    const { service } = await claimedFixture();
    const results = await Promise.allSettled([
      service.markContinuationToolResultRequired('receipt', 3, { status: 'success' }),
      service.markContinuationToolResultRequired('receipt', 3, { status: 'error' }),
    ]);
    expect(results.map(result => result.status)).toEqual(['fulfilled', 'rejected']);
    expect(await service.getById('receipt')).toMatchObject({ revision: 4, outcome: { status: 'success' } });
  });

  it.each(['missing', 'pending', 'denied', 'committed', 'wrong-kind'] as const)('fails closed for %s', async state => {
    const { service, sqlite } = await claimedFixture();
    if (state === 'missing') sqlite.exec("DELETE FROM hitl_requests WHERE id = 'receipt'");
    if (state === 'pending' || state === 'denied') sqlite.prepare('UPDATE hitl_requests SET status = ?').run(state);
    if (state === 'committed') sqlite.exec(`UPDATE hitl_requests SET continuation = '{"executionState":"tool_result_committed"}'`);
    if (state === 'wrong-kind') sqlite.exec("UPDATE hitl_requests SET kind = 'raapp_native'");
    await expect(service.markContinuationToolResultRequired('receipt', 3, { status: 'success' })).rejects.toThrow('HITL_EXECUTION_COMMIT_FAILED');
  });

  it('sanitizes driver failures without exposing request identifiers or driver content', async () => {
    const { service, sqlite } = await claimedFixture();
    sqlite.exec('DROP TABLE hitl_requests');
    await expect(service.markContinuationToolResultRequired('secret-id', 3, { status: 'success' })).rejects.toThrow(/^HITL_EXECUTION_COMMIT_FAILED$/);
  });
  it('returns the actual committed revision and rejects stale required commits', async () => {
    const service = makeService();
    await service.create({ id: 'receipt', kind: 'tool_confirmation', sessionId: 's', payload: {}, continuation: { executionState: 'pending' } });
    await service.resolve('receipt', 1, 'approved');
    await service.claimApprovedContinuation('receipt', 2);
    expect(await service.markContinuationToolResultRequired('receipt', 3, { status: 'success' })).toEqual({
      requestId: 'receipt', claimedRevision: 3, committedRevision: 4, status: 'approved',
      executionState: 'tool_result_committed', resultStatus: 'success',
    });
    await expect(service.markContinuationToolResultRequired('receipt', 3, { status: 'success' })).rejects.toThrow('HITL_EXECUTION_COMMIT_FAILED');
  });
  it('persists a request and resolves it exactly once with compare-and-set', async () => {
    const service = makeService();
    const request = await service.create({
      kind: 'tool_confirmation', sessionId: 's1', runId: 'run-1', turnId: 't1', toolCallId: 'call-1',
      payload: { toolName: 'fs_write' },
      continuation: {
        version: 1,
        kind: 'approved_tool_then_resume_turn',
        executionState: 'pending',
        messageId: 'assistant-tool-message',
        iteration: 2,
        currentLimit: 30,
      },
    });

    expect(request.runId).toBe('run-1');
    expect(request.continuation).toMatchObject({
      version: 1,
      kind: 'approved_tool_then_resume_turn',
      executionState: 'pending',
      messageId: 'assistant-tool-message',
      iteration: 2,
      currentLimit: 30,
    });
    expect(await service.listPending('s1')).toHaveLength(1);
    await expect(service.claimApprovedContinuation(request.id, request.revision)).resolves.toBeNull();
    await expect(service.resolve(request.id, request.revision, 'approved')).resolves.toBe(true);
    await expect(service.resolve(request.id, request.revision, 'approved')).resolves.toBe(false);
    await expect(service.listPending('s1')).resolves.toEqual([]);

    const approved = await service.getById(request.id);
    expect(approved).toMatchObject({ status: 'approved', revision: 2 });
    const claimed = await service.claimApprovedContinuation(request.id, approved!.revision);
    expect(claimed).toMatchObject({
      revision: 3,
      continuation: { executionState: 'claimed' },
    });
    await expect(service.claimApprovedContinuation(request.id, approved!.revision)).resolves.toBeNull();
    await expect(service.markContinuationToolResult(request.id, claimed!.revision, { status: 'success' })).resolves.toBe(true);
    await expect(service.getById(request.id)).resolves.toMatchObject({
      revision: 4,
      continuation: { executionState: 'tool_result_committed' },
      outcome: { status: 'success' },
    });
    expect((await service.getById(request.id))?.continuation).not.toHaveProperty('hostExecutionCommit');
  });

  it('projects only well-formed pending tool confirmations with timeout disabled', async () => {
    const service = makeService();
    await service.create({
      id: 'valid', kind: 'tool_confirmation', sessionId: 's1', toolCallId: 'call-1',
      payload: { toolName: 'fs_write', args: { path: 'report.md' } },
    });
    await service.create({
      id: 'invalid', kind: 'tool_confirmation', sessionId: 's1', toolCallId: 'call-2',
      payload: { toolName: 'fs_write', args: 'not-an-object' },
    });
    await service.create({
      id: 'other-kind', kind: 'tool_budget', sessionId: 's1',
      payload: { toolName: 'fs_write', args: {} },
    });

    await expect(service.listPendingToolConfirmations('s1')).resolves.toEqual([{
      requestId: 'valid', toolCallId: 'call-1', sessionId: 's1', toolName: 'fs_write',
      args: { path: 'report.md' }, timeoutMs: 0,
    }]);
  });

  it('preserves turn and prompt binding when rebuilding an approval after restart', async () => {
    const service = makeService();
    await service.create({
      id: 'restored', kind: 'tool_confirmation', sessionId: 's1',
      turnId: 'turn-1', toolCallId: 'call-1',
      payload: { toolName: 'fs_write', args: { path: 'styles.css' } },
      continuation: { promptMessageId: 'prompt-1', executionState: 'pending' },
    });
    expect(await service.listPendingToolConfirmations('s1')).toEqual([
      expect.objectContaining({ turnId: 'turn-1', promptMessageId: 'prompt-1' }),
    ]);
  });

  it('does not replay a pending confirmation into a different session', async () => {
    const service = makeService();
    await service.create({
      id: 'scoped', kind: 'tool_confirmation', sessionId: 'owner', turnId: 'turn', toolCallId: 'call',
      payload: { toolName: 'terminal_spawn', args: { command: 'npm run build' } },
      continuation: { promptMessageId: 'prompt' },
    });
    expect(await service.listPendingToolConfirmations('other')).toEqual([]);
    expect(await service.listPendingToolConfirmations('owner')).toHaveLength(1);
  });

  it('omits malformed prompt linkage rather than emitting a non-string id', async () => {
    const service = makeService();
    await service.create({
      id: 'legacy', kind: 'tool_confirmation', sessionId: 's1', toolCallId: 'call',
      payload: { toolName: 'fs_write', args: { path: 'styles.css' } },
      continuation: { promptMessageId: 123 },
    });
    const [request] = await service.listPendingToolConfirmations('s1');
    expect(request).not.toHaveProperty('promptMessageId');
    expect(request).not.toHaveProperty('turnId');
  });
});
