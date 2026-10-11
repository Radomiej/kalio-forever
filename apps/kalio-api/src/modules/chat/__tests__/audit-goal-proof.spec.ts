import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import type { DrizzleService } from '../../../database/drizzle.service';
import { AuditService } from '../audit.service';

const clients: Database.Database[] = [];
afterEach(() => clients.splice(0).forEach(client => client.close()));
const key = { id: 'proof', runId: 'run', rootSessionId: 'root', label: 'goal_receipt:committed' };
const data = '{ "architectureRunId":"run", "rootSessionId":"root", "text":"Żółć 😀" }';
function fixture() {
  const client = new Database(':memory:'); clients.push(client);
  client.exec(`CREATE TABLE audit_log (id TEXT PRIMARY KEY, session_id TEXT, type TEXT NOT NULL,
    label TEXT NOT NULL, data TEXT, duration_ms INTEGER, chunk_count INTEGER, created_at INTEGER NOT NULL);
    CREATE TABLE audit_log_archive (id TEXT PRIMARY KEY, session_id TEXT, type TEXT NOT NULL,
    label TEXT NOT NULL, data TEXT, duration_ms INTEGER, chunk_count INTEGER, created_at INTEGER NOT NULL, archived_at INTEGER NOT NULL);`);
  const db = drizzle(client);
  const service = new AuditService({ db } as unknown as DrizzleService);
  function seed(table = 'audit_log', value = data, id = 'proof', label = key.label) {
    client.prepare(`INSERT INTO ${table} (id,session_id,type,label,data,created_at${table.endsWith('archive') ? ',archived_at' : ''})
      VALUES (?,?,?,?,?,1234${table.endsWith('archive') ? ',2345' : ''})`).run(id, 'root', 'architecture_event', label, value);
  }
  return { client, db, service, seed };
}

describe('goal audit proof persistence (real SQLite)', () => {
  it.each(['architecture_event:goal_launch_authorization', 'architecture_event:goal_route_admission'])('rejects generic insertion of reserved %s', async label => {
    const f = fixture(); const entry = { sessionId: 'root', type: 'architecture_event' as const, label, data: { runId: 'run', rootSessionId: 'root' } };
    await expect(f.service.log(entry)).rejects.toThrow(/^AUDIT_GOAL_LAUNCH_RESERVED$/);
    await expect(f.service.logRequired('forged', entry)).rejects.toThrow(/^AUDIT_GOAL_LAUNCH_RESERVED$/);
    expect(f.client.prepare('SELECT count(*) AS n FROM audit_log').get()).toEqual({ n: 0 });
  });
  it.each(['architecture_event:goal_route_visit', 'architecture_event:goal_launch_authorization:extra', 'architecture_event:goal_route_admission:extra'])('preserves legitimate neighboring label %s', async label => {
    const f = fixture();
    await f.service.logRequired('ordinary-required', { sessionId: 'root', type: 'architecture_event', label, data: { runId: 'run', rootSessionId: 'root' } });
    expect(f.client.prepare('SELECT id,label FROM audit_log').get()).toEqual({ id: 'ordinary-required', label });
  });
  it.each(['audit_log', 'audit_log_archive'])('reads exact %s bytes without reserialization', async table => {
    const f = fixture(); f.seed(table);
    const row = await f.service.readGoalProofExact(key);
    expect(row).toMatchObject({ id: 'proof', sessionId: 'root', type: 'architecture_event', label: key.label,
      dataJson: data, dataUtf8Bytes: Buffer.byteLength(data), dataSha256: createHash('sha256').update(data).digest('hex'), createdAt: 1234 });
    expect(row.data).toEqual({ architectureRunId: 'run', rootSessionId: 'root', text: 'Żółć 😀' });
  });
  it('accepts identical hot/archive copies', async () => {
    const f = fixture(); f.seed(); f.seed('audit_log_archive');
    expect((await f.service.readGoalProofExact(key)).dataJson).toBe(data);
  });
  it.each(['data', 'session_id', 'label', 'created_at', 'duration_ms'])('rejects conflicting duplicate %s', async column => {
    const f = fixture(); f.seed(); f.seed('audit_log_archive');
    f.client.prepare(`UPDATE audit_log_archive SET ${column} = ?`).run(['created_at', 'duration_ms'].includes(column) ? 9 : 'foreign');
    await expect(f.service.readGoalProofExact(key)).rejects.toThrow(/^AUDIT_PROOF_CONFLICT$/);
  });
  it.each(['id', 'runId', 'rootSessionId', 'label'])('never substitutes a foreign %s', async field => {
    const f = fixture(); f.seed();
    await expect(f.service.readGoalProofExact({ ...key, [field]: 'foreign' })).rejects.toThrow(/^AUDIT_PROOF_(MISSING|SCOPE_INVALID)$/);
  });
  it('rejects missing and pruned records', async () => {
    const f = fixture(); await expect(f.service.readGoalProofExact(key)).rejects.toThrow(/^AUDIT_PROOF_MISSING$/);
    f.seed('audit_log_archive'); f.client.exec('DELETE FROM audit_log_archive');
    await expect(f.service.readGoalProofExact(key)).rejects.toThrow(/^AUDIT_PROOF_MISSING$/);
  });
  it.each(['not-json', 'null', '[]', '{"runId":"run","architectureRunId":"foreign","rootSessionId":"root"}'])('rejects malformed/contradictory data %s', async value => {
    const f = fixture(); f.seed('audit_log', value);
    await expect(f.service.readGoalProofExact(key)).rejects.toThrow(/^AUDIT_PROOF_(CORRUPT|SCOPE_INVALID)$/);
  });
  it('rejects invalid UTF8 bytes and static driver failures', async () => {
    const f = fixture(); f.seed(); f.client.exec("UPDATE audit_log SET data = CAST(X'FF' AS TEXT)");
    await expect(f.service.readGoalProofExact(key)).rejects.toThrow(/^AUDIT_PROOF_CORRUPT$/);
    f.client.exec('DROP TABLE audit_log_archive');
    await expect(f.service.readGoalProofExact(key)).rejects.toThrow(/^AUDIT_PROOF_STORAGE_ERROR$/);
  });
  it('does not invoke locator accessors', async () => {
    const f = fixture(); let reads = 0;
    const raw = { ...key }; Object.defineProperty(raw, 'id', { enumerable: true, get() { reads++; return 'proof'; } });
    await expect(f.service.readGoalProofExact(raw)).rejects.toThrow(/^AUDIT_PROOF_INVALID_INPUT$/);
    expect(reads).toBe(0);
  });
  it('propagates abort before and after the SQLite read', async () => {
    const f = fixture(); f.seed(); const controller = new AbortController(); const reason = new Error('PRIVATE_ABORT_SECRET');
    controller.abort(new Error('PRIVATE_ABORT_SECRET')); await expect(f.service.readGoalProofExact(key, controller.signal)).rejects.toThrow(/^AUDIT_PROOF_ABORTED$/);
    const later = new AbortController(); const all = f.db.all.bind(f.db);
    f.db.all = ((...args: Parameters<typeof f.db.all>) => { const result = all(...args); later.abort(reason); return result; }) as typeof f.db.all;
    await expect(f.service.readGoalProofExact(key, later.signal)).rejects.toThrow(/^AUDIT_PROOF_ABORTED$/);
  });
  it('checks an expected leaf byte digest', async () => {
    const f = fixture(); f.seed();
    await expect(f.service.readGoalProofExact({ ...key, expectedDataSha256: '0'.repeat(64) })).rejects.toThrow(/^AUDIT_PROOF_HASH_MISMATCH$/);
  });
  it.each(['goal_receipt:committed', 'architecture_event:goal_protocol', 'goal_completion:aggregate', 'goal_completion:authorized'])('rejects all updates to proof label %s', async label => {
    const f = fixture(); f.seed('audit_log', data, 'proof', label);
    await expect(f.service.update('proof', { data: { erased: true }, chunkCount: 1, durationMs: 2 })).rejects.toThrow(/^AUDIT_PROOF_IMMUTABLE$/);
    expect(f.client.prepare('SELECT data FROM audit_log').get()).toEqual({ data });
  });
  it('protects metadata-marked and archived proof rows too', async () => {
    const f = fixture(); f.seed('audit_log', '{"eventType":"goal_protocol"}', 'proof', 'ordinary');
    await expect(f.service.update('proof', { data: {} })).rejects.toThrow(/^AUDIT_PROOF_IMMUTABLE$/);
    f.client.exec('DELETE FROM audit_log'); f.seed('audit_log_archive');
    await expect(f.service.update('proof', { durationMs: 4 })).rejects.toThrow(/^AUDIT_PROOF_IMMUTABLE$/);
  });
  it('preserves ordinary telemetry updates', async () => {
    const f = fixture(); f.seed('audit_log', '{}', 'ordinary', 'turn-start');
    await f.service.update('ordinary', { data: { tokens: 10 }, durationMs: 12, chunkCount: 3 });
    expect(f.client.prepare('SELECT data,duration_ms,chunk_count FROM audit_log').get()).toEqual({ data: '{"tokens":10}', duration_ms: 12, chunk_count: 3 });
  });
  it.each(['audit_log', 'audit_log_archive'])('protects additive boolean goal stop marker in %s', async table => {
    const f = fixture(); const value = JSON.stringify({ runId: 'run', rootSessionId: 'root',
      eventType: 'run_stopped', goalProtocol: true });
    f.seed(table, value, 'stop', 'architecture_event:run_stopped:runtime');
    const locator = { ...key, id: 'stop', label: 'architecture_event:run_stopped:runtime' };
    expect((await f.service.readGoalProofExact(locator)).data.eventType).toBe('run_stopped');
    await expect(f.service.update('stop', { data: {}, durationMs: 3 })).rejects.toThrow(/^AUDIT_PROOF_IMMUTABLE$/);
    expect(f.client.prepare(`SELECT data FROM ${table}`).get()).toEqual({ data: value });
  });
  it.each([false, 'true', 1, null])('does not promote nonboolean goal marker %s', async goalProtocol => {
    const f = fixture(); f.seed('audit_log', JSON.stringify({ goalProtocol }), 'stop', 'architecture_event:run_stopped:runtime');
    await f.service.update('stop', { data: { ordinary: true }, durationMs: 3 });
    expect(f.client.prepare('SELECT data,duration_ms FROM audit_log').get()).toEqual({ data: '{"ordinary":true}', duration_ms: 3 });
  });
  it.each(['goalBinding', 'completionBinding'])('protects required router checkpoints with %s in hot and archive storage', async binding => {
    const f = fixture();
    const persisted = JSON.stringify({ domain: 'architecture', kind: 'architecture_event', runId: 'run',
      architectureRunId: 'run', rootSessionId: 'root', eventType: 'router_decision',
      [binding]: { stateRevision: 3, sourceVersion: 1, sourceFingerprint: 'a'.repeat(64) } });
    await f.service.logRequired('required-route', { sessionId: 'root', type: 'architecture_event',
      label: 'architecture_event:router_decision:worker', data: JSON.parse(persisted) as Record<string, unknown> });
    await expect(f.service.update('required-route', { data: {}, durationMs: 2 })).rejects.toThrow(/^AUDIT_PROOF_IMMUTABLE$/);
    f.client.exec('INSERT INTO audit_log_archive SELECT *,2345 FROM audit_log; DELETE FROM audit_log');
    await expect(f.service.update('required-route', { chunkCount: 1 })).rejects.toThrow(/^AUDIT_PROOF_IMMUTABLE$/);
    expect(f.client.prepare('SELECT data FROM audit_log_archive').get()).toEqual({ data: persisted });
  });
  const aggregate = { sessionId: 'root', type: 'architecture_event' as const, label: 'goal_completion:aggregate' as const,
    data: { schemaVersion: 1, recordType: 'goal_completion_aggregate', runId: 'run', rootSessionId: 'root', note: 'Żółć 😀' } };
  it('writes content-addressed exact bytes, replays from archive and refuses mutation', async () => {
    const f = fixture(); const expectedJson = JSON.stringify(aggregate.data);
    const digest = createHash('sha256').update(expectedJson).digest('hex');
    const first = await f.service.logContentAddressedGoalAggregateRequired(aggregate);
    expect(first.id).toBe(`goal-aggregate:sha256:${digest}`); expect(first.dataJson).toBe(expectedJson);
    f.client.exec('INSERT INTO audit_log_archive SELECT *,2345 FROM audit_log; DELETE FROM audit_log');
    const replay = await f.service.logContentAddressedGoalAggregateRequired(aggregate);
    expect(replay).toEqual(first);
    expect(f.client.prepare('SELECT count(*) AS n FROM audit_log').get()).toEqual({ n: 0 });
    await expect(f.service.update(first.id, { data: {} })).rejects.toThrow(/^AUDIT_PROOF_IMMUTABLE$/);
  });
  it('detects direct storage mutation of content-addressed data', async () => {
    const f = fixture(); const record = await f.service.logContentAddressedGoalAggregateRequired(aggregate);
    f.client.prepare('UPDATE audit_log SET data = ?').run(JSON.stringify({ ...aggregate.data, note: 'changed' }));
    await expect(f.service.readGoalProofExact({ id: record.id, runId: 'run', rootSessionId: 'root', label: aggregate.label })).rejects.toThrow(/^AUDIT_PROOF_HASH_MISMATCH$/);
  });
  it('rejects aggregate getters without serialization and propagates abort', async () => {
    const f = fixture(); let reads = 0; const raw = { ...aggregate, data: { ...aggregate.data } };
    Object.defineProperty(raw.data, 'note', { enumerable: true, get() { reads++; return 'secret'; } });
    await expect(f.service.logContentAddressedGoalAggregateRequired(raw)).rejects.toThrow(/^AUDIT_PROOF_INVALID_INPUT$/);
    expect(reads).toBe(0);
    const controller = new AbortController(); const reason = new Error('PRIVATE_ABORT_SECRET'); controller.abort(reason);
    await expect(f.service.logContentAddressedGoalAggregateRequired(aggregate, controller.signal)).rejects.toThrow(/^AUDIT_PROOF_ABORTED$/);
    expect(f.client.prepare('SELECT count(*) AS n FROM audit_log').get()).toEqual({ n: 0 });
  });
  it('rolls back aggregate insertion when readback bytes do not match', async () => {
    const f = fixture(); f.client.exec(`CREATE TRIGGER corrupt_aggregate AFTER INSERT ON audit_log
      BEGIN UPDATE audit_log SET data = '{"runId":"run","rootSessionId":"root","recordType":"goal_completion_aggregate"}' WHERE id = NEW.id; END`);
    await expect(f.service.logContentAddressedGoalAggregateRequired(aggregate)).rejects.toThrow(/^AUDIT_PROOF_HASH_MISMATCH$/);
    expect(f.client.prepare('SELECT count(*) AS n FROM audit_log').get()).toEqual({ n: 0 });
  });
  it('propagates abort raised inside the writer transaction and rolls back', async () => {
    const f = fixture(); const controller = new AbortController(); const reason = new Error('PRIVATE_ABORT_SECRET');
    const transaction = f.db.transaction.bind(f.db);
    f.db.transaction = ((callback: Parameters<typeof f.db.transaction>[0]) => transaction(tx => {
      const insert = tx.insert.bind(tx);
      tx.insert = ((...args: Parameters<typeof tx.insert>) => { controller.abort(reason); return insert(...args); }) as typeof tx.insert;
      return callback(tx);
    })) as typeof f.db.transaction;
    await expect(f.service.logContentAddressedGoalAggregateRequired(aggregate, controller.signal)).rejects.toThrow(/^AUDIT_PROOF_ABORTED$/);
    expect(f.client.prepare('SELECT count(*) AS n FROM audit_log').get()).toEqual({ n: 0 });
  });
  it('rejects ordinary architecture telemetry as goal proof', async () => {
    const f = fixture(); f.seed('audit_log', data, 'proof', 'ordinary');
    await expect(f.service.readGoalProofExact({ ...key, label: 'ordinary' })).rejects.toThrow(/^AUDIT_PROOF_SCOPE_INVALID$/);
  });
  it('sanitizes cancellation during a driver failure', async () => {
    const f = fixture(); const controller = new AbortController();
    f.db.all = (() => { controller.abort('PRIVATE_ABORT_SECRET'); throw new Error('PRIVATE_DRIVER_SECRET'); }) as typeof f.db.all;
    await expect(f.service.readGoalProofExact(key, controller.signal)).rejects.toThrow(/^AUDIT_PROOF_ABORTED$/);
  });
  it('sanitizes cancellation after aggregate transaction acknowledgment', async () => {
    const f = fixture(); const controller = new AbortController(); const transaction = f.db.transaction.bind(f.db);
    f.db.transaction = ((callback: Parameters<typeof f.db.transaction>[0]) => {
      const result = transaction(callback); controller.abort(new Error('PRIVATE_ABORT_SECRET')); return result;
    }) as typeof f.db.transaction;
    await expect(f.service.logContentAddressedGoalAggregateRequired(aggregate, controller.signal)).rejects.toThrow(/^AUDIT_PROOF_ABORTED$/);
    expect(f.client.prepare('SELECT count(*) AS n FROM audit_log').get()).toEqual({ n: 1 });
  });
  it('prevents serialization hooks from changing a row into proof before update', async () => {
    const f = fixture(); f.seed('audit_log', '{}', 'ordinary', 'turn-start');
    await f.service.update('ordinary', { data: { toJSON() {
      f.client.exec("UPDATE audit_log SET label = 'goal_receipt:committed' WHERE id = 'ordinary'");
      return { erased: true };
    } } });
    // A lossy hook-bearing patch must never enter the update transaction.
    expect(f.client.prepare('SELECT data,label FROM audit_log').get()).toEqual({ data: '{}', label: 'turn-start' });
  });
});
