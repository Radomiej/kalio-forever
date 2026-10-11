import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import type { HostHitlExecutionCommit } from '@kalio/types';
import * as schema from '../../database/schema';
import type { DrizzleService } from '../../database/drizzle.service';
import { HitlRequestService } from '../hitl/hitl-request.service';
import { createHostDispatchPersistenceAuthority } from './host-dispatch-persistence-authority';

const clients: Database.Database[] = [];
afterEach(() => clients.splice(0).forEach(client => { if (client.open) client.close(); }));
const identity = { runId: 'run', sessionId: 'session', turnId: 'turn', promptMessageId: 'prompt' };
const key = { ...identity, callId: 'call' };
const approval = { kind: 'durable_confirmation' as const, requestId: 'hitl', claimedRevision: 3 };
const commit: HostHitlExecutionCommit = { requestId: 'hitl', claimedRevision: 3, committedRevision: 4,
  status: 'approved', executionState: 'tool_result_committed', resultStatus: 'success' };
const continuation = { version: 1, kind: 'approved_tool_then_resume_turn', ...identity,
  executionState: 'tool_result_committed', hostExecutionCommit: commit };
function fixture() {
  const client = new Database(':memory:'); clients.push(client);
  client.exec(`CREATE TABLE chat_runs (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, turn_id TEXT NOT NULL, revision INTEGER NOT NULL);
    CREATE TABLE messages (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, turn_id TEXT, prompt_message_id TEXT, role TEXT NOT NULL);
    CREATE TABLE hitl_requests (id TEXT PRIMARY KEY, kind TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', session_id TEXT NOT NULL,
      turn_id TEXT, run_id TEXT, tool_call_id TEXT, payload TEXT NOT NULL, continuation TEXT, outcome TEXT, revision INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, resolved_at INTEGER);
    INSERT INTO chat_runs VALUES ('run','session','turn',9);
    INSERT INTO messages VALUES ('prompt','session','turn','prompt','user');`);
  client.prepare('INSERT INTO hitl_requests VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run('hitl', 'tool_confirmation', 'approved',
    'session', 'turn', 'run', 'call', JSON.stringify({ toolName: 'terminal_spawn', args: { secret: 'never return' } }),
    JSON.stringify(continuation), JSON.stringify({ status: 'success' }), 4, 1, 2, 2);
  const db = drizzle(client, { schema });
  return { client, authority: createHostDispatchPersistenceAuthority(db),
    producer: new HitlRequestService({ db } as unknown as DrizzleService) };
}
describe('host dispatch concrete SQLite persistence authority', () => {
  it('reads exact journal scope with current positive persisted revision', async () => {
    const { authority, client } = fixture();
    expect(await authority.readJournalScopeExact(identity)).toEqual({ ...identity, revision: 9 });
    client.exec('UPDATE chat_runs SET revision = 21');
    expect(await authority.readJournalScopeExact(identity)).toEqual({ ...identity, revision: 21 });
  });
  it.each(['runId', 'sessionId', 'turnId', 'promptMessageId'])('requires exact journal %s', async field => {
    expect(await fixture().authority.readJournalScopeExact({ ...identity, [field]: 'foreign' })).toBeNull();
  });
  it.each(['session_id', 'turn_id', 'prompt_message_id', 'role'])('requires exact self-linked local user prompt %s', async field => {
    const { authority, client } = fixture(); client.exec(`UPDATE messages SET ${field} = 'foreign'`);
    expect(await authority.readJournalScopeExact(identity)).toBeNull();
  });
  it.each([0, -1, 1.5])('rejects corrupt persisted journal revision %s', async revision => {
    const { authority, client } = fixture(); client.prepare('UPDATE chat_runs SET revision = ?').run(revision);
    await expect(authority.readJournalScopeExact(identity)).rejects.toThrow(/^HOST_DISPATCH_AUTHORITY_CORRUPT$/);
  });
  it('reads durable six-field commit and full linkage without returning arguments', async () => {
    const result = await fixture().authority.readHitlExact(key, approval, commit);
    expect(result).toEqual({ identity, callId: key.callId, toolName: 'terminal_spawn', approval, commit });
    expect(JSON.stringify(result)).not.toContain('never return');
  });
  it.each(['runId', 'sessionId', 'turnId', 'promptMessageId', 'callId'])('requires exact HITL %s', async field => {
    expect(await fixture().authority.readHitlExact({ ...key, [field]: 'foreign' }, approval, commit)).toBeNull();
  });
  it.each(['kind', 'status', 'session_id', 'turn_id', 'run_id', 'tool_call_id'])('rejects HITL row mismatch %s', async field => {
    const { authority, client } = fixture(); client.exec(`UPDATE hitl_requests SET ${field} = 'foreign'`);
    expect(await authority.readHitlExact(key, approval, commit)).toBeNull();
  });
  it.each(['runId', 'sessionId', 'turnId', 'promptMessageId', 'executionState'])('rejects continuation drift %s', async field => {
    const { authority, client } = fixture();
    client.prepare('UPDATE hitl_requests SET continuation = ?').run(JSON.stringify({ ...continuation, [field]: 'foreign' }));
    expect(await authority.readHitlExact(key, approval, commit)).toBeNull();
  });
  it.each(['requestId', 'claimedRevision', 'committedRevision', 'status', 'executionState', 'resultStatus'])('rejects durable commit drift %s', async field => {
    const { authority, client } = fixture(); const changed = field.includes('Revision') ? 12 : 'foreign';
    client.prepare('UPDATE hitl_requests SET continuation = ?').run(JSON.stringify({ ...continuation, hostExecutionCommit: { ...commit, [field]: changed } }));
    expect(await authority.readHitlExact(key, approval, commit)).toBeNull();
  });
  it('fails closed for absent commit, outcome mismatch and later row revision', async () => {
    const { authority, client } = fixture();
    client.prepare('UPDATE hitl_requests SET continuation = ?').run(JSON.stringify({ ...continuation, hostExecutionCommit: undefined }));
    expect(await authority.readHitlExact(key, approval, commit)).toBeNull();
    client.prepare('UPDATE hitl_requests SET continuation = ?, outcome = ?').run(JSON.stringify(continuation), '{"status":"error"}');
    expect(await authority.readHitlExact(key, approval, commit)).toBeNull();
    client.exec("UPDATE hitl_requests SET outcome = '{\"status\":\"success\"}', revision = 99");
    expect(await authority.readHitlExact(key, approval, commit)).toBeNull();
  });
  it('rejects extra durable commit fields and malformed raw JSON', async () => {
    const { authority, client } = fixture();
    client.prepare('UPDATE hitl_requests SET continuation = ?').run(JSON.stringify({ ...continuation, hostExecutionCommit: { ...commit, extra: true } }));
    await expect(authority.readHitlExact(key, approval, commit)).rejects.toThrow(/^HOST_DISPATCH_AUTHORITY_CORRUPT$/);
    client.exec("UPDATE hitl_requests SET continuation = '{'");
    await expect(authority.readHitlExact(key, approval, commit)).rejects.toThrow(/^HOST_DISPATCH_AUTHORITY_CORRUPT$/);
  });
  it.each(['identity', 'key', 'approval', 'commit'])('rejects accessor %s without invoking it', async kind => {
    const { authority } = fixture(); let reads = 0;
    const supplied = kind === 'identity' ? { ...identity } : kind === 'key' ? { ...key } : kind === 'approval' ? { ...approval } : { ...commit };
    const field = kind === 'identity' || kind === 'key' ? 'runId' : 'requestId';
    Object.defineProperty(supplied, field, { enumerable: true, get() { reads++; return 'secret'; } });
    await expect(kind === 'identity' ? authority.readJournalScopeExact(supplied as typeof identity)
      : authority.readHitlExact(kind === 'key' ? supplied as typeof key : key, kind === 'approval' ? supplied as typeof approval : approval,
        kind === 'commit' ? supplied as typeof commit : commit)).rejects.toThrow(/^HOST_DISPATCH_AUTHORITY_INVALID$/);
    expect(reads).toBe(0);
  });
  it.each(['proxy', 'symbol', 'hidden', 'extra'])('rejects unsafe identity %s', async mode => {
    const { authority } = fixture(); const supplied = { ...identity }; let traps = 0;
    if (mode === 'symbol') Reflect.set(supplied, Symbol('extra'), true);
    if (mode === 'hidden') Object.defineProperty(supplied, 'extra', { value: true });
    if (mode === 'extra') Reflect.set(supplied, 'extra', true);
    const input = mode === 'proxy' ? new Proxy(supplied, { ownKeys(target) { traps++; return Reflect.ownKeys(target); } }) : supplied;
    await expect(authority.readJournalScopeExact(input)).rejects.toThrow(/^HOST_DISPATCH_AUTHORITY_INVALID$/); expect(traps).toBe(0);
  });
  it('fails statically on abort or driver failure', async () => {
    const { authority, client } = fixture(); const controller = new AbortController(); controller.abort();
    await expect(authority.readJournalScopeExact(identity, controller.signal)).rejects.toThrow(/^HOST_DISPATCH_AUTHORITY_ABORTED$/);
    await expect(authority.readHitlExact(key, approval, commit, controller.signal)).rejects.toThrow(/^HOST_DISPATCH_AUTHORITY_ABORTED$/);
    client.exec('DROP TABLE chat_runs; DROP TABLE hitl_requests');
    await expect(authority.readJournalScopeExact(identity)).rejects.toThrow(/^HOST_DISPATCH_AUTHORITY_STORAGE$/);
    await expect(authority.readHitlExact(key, approval, commit)).rejects.toThrow(/^HOST_DISPATCH_AUTHORITY_STORAGE$/);
  });
  it.each(['success', 'error', 'cancelled'] as const)('reads actual producer %s commit after close/reopen without revision arithmetic', async status => {
    const { producer, authority, client } = fixture(); client.exec('DELETE FROM hitl_requests');
    await producer.create({ id: 'actual', kind: 'tool_confirmation', sessionId: identity.sessionId, turnId: identity.turnId,
      runId: identity.runId, toolCallId: key.callId, payload: { toolName: 'terminal_spawn', args: {} },
      continuation: { version: 1, kind: 'approved_tool_then_resume_turn', ...identity, executionState: 'pending' } });
    await producer.resolve('actual', 1, 'approved'); await producer.claimApprovedContinuation('actual', 2);
    client.exec(`CREATE TRIGGER actual_revision AFTER UPDATE OF outcome ON hitl_requests
      BEGIN UPDATE hitl_requests SET revision = 17 WHERE id = NEW.id; END;`);
    const actual = await producer.markContinuationToolResultRequired('actual', 3, { status });
    expect(actual.claimedRevision).toBe(3); expect(actual.committedRevision).toBe(17);
    const actualApproval = { ...approval, requestId: 'actual', claimedRevision: actual.claimedRevision };
    expect(await authority.readHitlExact(key, actualApproval, actual)).toEqual({ identity, callId: key.callId,
      toolName: 'terminal_spawn', approval: actualApproval, commit: actual });
    const saved = client.serialize(); client.close(); const reopened = new Database(saved); clients.push(reopened);
    const restarted = createHostDispatchPersistenceAuthority(drizzle(reopened, { schema }));
    expect(await restarted.readJournalScopeExact(identity)).toEqual({ ...identity, revision: 9 });
    expect(await restarted.readHitlExact(key, actualApproval, actual)).toEqual({ identity, callId: key.callId,
      toolName: 'terminal_spawn', approval: actualApproval, commit: actual });
    expect(await restarted.readHitlExact(key, { ...actualApproval, claimedRevision: 16 }, { ...actual, claimedRevision: 16 })).toBeNull();
  });
  it('matches actual gated producer scope without treating approval as human authorization', async () => {
    const { producer, authority, client } = fixture(); client.exec('DELETE FROM hitl_requests');
    await producer.create({ id: 'gated', kind: 'tool_confirmation', sessionId: identity.sessionId, turnId: identity.turnId,
      runId: identity.runId, toolCallId: key.callId, payload: { toolName: 'terminal_spawn', args: {} },
      continuation: { version: 1, kind: 'approved_tool_then_resume_turn', ...identity, executionState: 'pending',
        hostConfirmationRequirement: { kind: 'human_only', toolName: 'terminal_spawn', callId: key.callId } } });
    expect(await producer.resolveHostConfirmationFromGateway('gated', 1, identity.sessionId, 'socket')).toBe(true);
    const claimed = await producer.claimApprovedHostContinuation('gated', 2, identity.sessionId, key.callId);
    expect(claimed).not.toBeNull();
    const actual = await producer.markContinuationToolResultRequired('gated', claimed!.revision, { status: 'success' });
    expect(await authority.readHitlExact(key, { kind: 'durable_confirmation', requestId: actual.requestId, claimedRevision: actual.claimedRevision }, actual))
      .toMatchObject({ identity, callId: key.callId, toolName: 'terminal_spawn', commit: actual });
    client.prepare('UPDATE hitl_requests SET payload = ?').run('{"toolName":"other"}');
    expect(await authority.readHitlExact(key, { kind: 'durable_confirmation', requestId: actual.requestId, claimedRevision: actual.claimedRevision }, actual)).toBeNull();
  });
  it.each(['payload', 'continuation', 'outcome'])('rejects corrupt persisted UTF-8 in %s without normalization', async column => {
    const { authority, client } = fixture(); client.exec(`UPDATE hitl_requests SET ${column} = CAST(X'FF' AS TEXT)`);
    await expect(authority.readHitlExact(key, approval, commit)).rejects.toThrow(/^HOST_DISPATCH_AUTHORITY_CORRUPT$/);
  });
});
