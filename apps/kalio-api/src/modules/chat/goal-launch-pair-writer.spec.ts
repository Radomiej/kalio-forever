import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../../database/schema';
import { readGoalProofExact } from './audit-goal-proof';
import { createGoalLaunchPairWriter, type GoalLaunchPairInput } from './goal-launch-pair-writer';
import { createGoalLaunchReservationStore } from './goal-launch-reservation';

const clients: Database.Database[] = []; const dirs: string[] = [];
afterEach(() => { clients.splice(0).forEach(c => { if (c.open) c.close(); }); dirs.splice(0).forEach(d => rmSync(d, { recursive: true, force: true })); });
const authLabel = 'architecture_event:goal_launch_authorization'; const admissionLabel = 'architecture_event:goal_route_admission';
const hash = 'a'.repeat(64);
const parent = { parentRunId: 'parent-run', parentSessionId: 'HOST', parentTurnId: 'parent-turn', promptMessageId: 'prompt', callId: 'parent-call' };
const descriptor = { version: 1 as const, flowDefinitionId: 'flow', schemaId: 'schema', startMode: 'durable' as const,
  vfsMode: 'isolated' as const, returnMode: 'summary' as const, copyBack: false, maxSteps: null,
  argsSha256: 'a'.repeat(64), sourceContentSha256: 'b'.repeat(64), schemaDefinitionSha256: 'c'.repeat(64), flowDefinitionSha256: 'd'.repeat(64) };
const descriptorSha256 = createHash('sha256').update(JSON.stringify(descriptor), 'utf8').digest('hex');
const archivePairSql = `INSERT INTO audit_log_archive(id,session_id,type,label,data,duration_ms,chunk_count,created_at,archived_at)
  SELECT id,session_id,type,label,data,duration_ms,chunk_count,created_at,42 FROM audit_log;`;
function input(): GoalLaunchPairInput {
  const base = { schemaVersion: 1, goalProtocol: true, runId: 'run', rootSessionId: 'internal-root', schemaId: 'schema',
    binding: { stateRevision: 1, sourceVersion: 1, sourceFingerprint: hash } };
  return { authorizationId: 'opaque-auth', admissionId: 'opaque-admission',
    reservation: { parent: { ...parent }, descriptor: { ...descriptor }, descriptorSha256 },
    authorizationData: { ...base, recordType: 'goal_launch_authorization', sequence: 1,
      parentRunId: 'parent-run', parentToolCallId: 'parent-call', reservationDescriptorSha256: descriptorSha256,
      source: { sessionId: 'HOST', messageId: 'prompt', turnId: 'parent-turn' }, note: 'Żółć 😀' },
    admissionData: { ...base, recordType: 'goal_route_admission', sequence: 2, admissionKind: 'launch',
      nodeId: 'worker', visit: 1, branchSessionId: 'branch', predecessorAdmissionRef: null, stopRef: null, entryRouteRef: null } };
}
function fixture(path = ':memory:', reserve = true) {
  const client = new Database(path); clients.push(client);
  const db = drizzle(client, { schema }); const cap = Object.freeze({});
  client.pragma('foreign_keys = ON');
  migrate(db, { migrationsFolder: resolve(__dirname, '../../database/migrations') });
  client.prepare(`INSERT OR IGNORE INTO chat_runs(id,session_id,turn_id,phase,status,started_at,updated_at,last_heartbeat_at)
    VALUES ('parent-run','HOST','parent-turn','running','running',1,1,1)`).run();
  const reservations = createGoalLaunchReservationStore(db, () => ({ childRunId: 'run', rootSessionId: 'internal-root',
    authorizationId: 'opaque-auth', admissionId: 'opaque-admission' }));
  if (reserve) reservations.reserve(parent, descriptor);
  const map = new WeakMap<object, GoalLaunchPairInput>(); map.set(cap, input());
  const writer = createGoalLaunchPairWriter(db, c => map.get(c) ?? null);
  const count = () => client.prepare('SELECT count(*) AS n FROM audit_log').get();
  return { client, db, cap, map, writer, count, reservations };
}
describe('closed atomic goal launch pair writer (real SQLite)', () => {
  it('rejects a missing persisted reservation before either insert', () => {
    const f = fixture(':memory:', false);
    expect(() => f.writer.writeRequired(f.cap)).toThrow('GOAL_LAUNCH_PAIR_RESERVATION');
    expect(f.count()).toEqual({ n: 0 });
  });
  it.each(['parent', 'hash', 'schema-definition', 'flow-definition', 'new-child', 'new-root', 'new-auth', 'new-admission', 'source', 'parent-call'])(
    'rejects recreated capability with forged reservation %s', kind => {
      const f = fixture(); const raw = input();
      if (kind === 'parent') raw.reservation.parent.callId = 'foreign-call';
      if (kind === 'hash') raw.reservation.descriptorSha256 = 'f'.repeat(64);
      if (kind === 'schema-definition') raw.reservation.descriptor.schemaDefinitionSha256 = 'f'.repeat(64);
      if (kind === 'flow-definition') raw.reservation.descriptor.flowDefinitionSha256 = 'f'.repeat(64);
      if (kind === 'new-child') { Reflect.set(raw.authorizationData, 'runId', 'other'); Reflect.set(raw.admissionData, 'runId', 'other'); }
      if (kind === 'new-root') { Reflect.set(raw.authorizationData, 'rootSessionId', 'other'); Reflect.set(raw.admissionData, 'rootSessionId', 'other'); }
      if (kind === 'new-auth') raw.authorizationId = 'other-auth';
      if (kind === 'new-admission') raw.admissionId = 'other-admission';
      if (kind === 'source') Reflect.set(raw.authorizationData, 'source', { sessionId: 'foreign', messageId: 'prompt', turnId: 'parent-turn' });
      if (kind === 'parent-call') Reflect.set(raw.authorizationData, 'parentToolCallId', 'other-call');
      const cap = Object.freeze({}); f.map.set(cap, raw);
      expect(() => f.writer.writeRequired(cap)).toThrow('GOAL_LAUNCH_PAIR_RESERVATION');
      expect(f.count()).toEqual({ n: 0 }); expect(f.reservations.readExact(parent)?.ids.childRunId).toBe('run');
    },
  );
  it('writes exact scoped authorization and launch admission refs using the existing reader', async () => {
    const f = fixture(); const refs = f.writer.writeRequired(f.cap);
    const locator = { runId: 'run', rootSessionId: 'internal-root' };
    const auth = await readGoalProofExact(f.db, { ...locator, ...refs.authorizationRef });
    const admission = await readGoalProofExact(f.db, { ...locator, ...refs.admissionRef });
    expect(auth.data).toEqual(input().authorizationData);
    expect(admission.data).toEqual({ ...input().admissionData, authorizationRef: refs.authorizationRef });
    expect(auth.dataUtf8Bytes).toBe(Buffer.byteLength(auth.dataJson, 'utf8'));
    expect(refs.authorizationRef.label).toBe(authLabel); expect(refs.admissionRef.label).toBe(admissionLabel);
    expect(f.count()).toEqual({ n: 2 });
  });
  it('reads the exact pair after close/reopen without an in-memory capability', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kalio-launch-pair-')); dirs.push(dir); const path = join(dir, 'proof.db');
    const first = fixture(path); const refs = first.writer.writeRequired(first.cap); first.client.close();
    const reopened = fixture(path);
    expect(reopened.writer.writeRequired(reopened.cap)).toEqual(refs);
    for (const ref of Object.values(refs)) expect((await readGoalProofExact(reopened.db,
      { ...ref, runId: 'run', rootSessionId: 'internal-root' })).id).toBe(ref.id);
    expect(reopened.count()).toEqual({ n: 2 });
  });
  it('a recreated capability retries the winning pair but cannot create another child or pair', () => {
    const f = fixture(); const refs = f.writer.writeRequired(f.cap);
    const exactCap = Object.freeze({}); f.map.set(exactCap, input());
    expect(f.writer.writeRequired(exactCap)).toEqual(refs);
    const raw = input(); raw.authorizationId = 'new-auth'; raw.admissionId = 'new-admission';
    Reflect.set(raw.authorizationData, 'runId', 'new-child'); Reflect.set(raw.admissionData, 'runId', 'new-child');
    const foreignCap = Object.freeze({}); f.map.set(foreignCap, raw);
    expect(() => f.writer.writeRequired(foreignCap)).toThrow('GOAL_LAUNCH_PAIR_RESERVATION');
    expect(f.count()).toEqual({ n: 2 });
  });
  it.each(['schemaDefinitionSha256', 'flowDefinitionSha256'] as const)('rejects changed %s even with a recomputed claimed hash', key => {
    const f = fixture(); const raw = input(); raw.reservation.descriptor[key] = 'e'.repeat(64);
    raw.reservation.descriptorSha256 = createHash('sha256').update(JSON.stringify(raw.reservation.descriptor), 'utf8').digest('hex');
    Reflect.set(raw.authorizationData, 'reservationDescriptorSha256', raw.reservation.descriptorSha256);
    f.map.set(f.cap, raw);
    expect(() => f.writer.writeRequired(f.cap)).toThrow('GOAL_LAUNCH_PAIR_RESERVATION'); expect(f.count()).toEqual({ n: 0 });
  });
  it('rechecks the durable parent after capability resolution and rejects missing reservation envelope', () => {
    const f = fixture(); const writer = createGoalLaunchPairWriter(f.db, () => {
      f.client.exec("UPDATE chat_runs SET turn_id='changed' WHERE id='parent-run'"); return input();
    });
    expect(() => writer.writeRequired(f.cap)).toThrow('GOAL_LAUNCH_PAIR_RESERVATION'); expect(f.count()).toEqual({ n: 0 });
    const raw = input(); Reflect.deleteProperty(raw, 'reservation'); f.map.set(f.cap, raw);
    expect(() => f.writer.writeRequired(f.cap)).toThrow('GOAL_LAUNCH_PAIR_INVALID');
  });
  it('retries exact bytes without changing timestamp or duplicating rows', () => {
    const f = fixture(); const first = f.writer.writeRequired(f.cap);
    const before = f.client.prepare('SELECT * FROM audit_log ORDER BY id').all();
    expect(f.writer.writeRequired(f.cap)).toEqual(first);
    expect(f.client.prepare('SELECT * FROM audit_log ORDER BY id').all()).toEqual(before);
  });
  it('allows exact archived retry without recreating hot copies', () => {
    const f = fixture(); const refs = f.writer.writeRequired(f.cap);
    f.client.exec(archivePairSql + 'DELETE FROM audit_log;');
    expect(f.writer.writeRequired(f.cap)).toEqual(refs); expect(f.count()).toEqual({ n: 0 });
  });
  it.each(['data', 'label', 'session_id', 'created_at', 'duration_ms'])('rejects hot/archive conflict in %s', column => {
    const f = fixture(); f.writer.writeRequired(f.cap);
    f.client.exec(archivePairSql);
    f.client.prepare(`UPDATE audit_log_archive SET ${column}=? WHERE id=?`).run(['created_at', 'duration_ms'].includes(column) ? 9 : 'PRIVATE', 'opaque-auth');
    expect(() => f.writer.writeRequired(f.cap)).toThrow(/^GOAL_LAUNCH_PAIR_CONFLICT$/);
    expect(f.count()).toEqual({ n: 2 });
  });
  it('rejects changed payload and a partial existing pair instead of repairing it', () => {
    const f = fixture(); f.writer.writeRequired(f.cap);
    const changed = input(); Reflect.set(changed.authorizationData, 'note', 'other'); f.map.set(f.cap, changed);
    expect(() => f.writer.writeRequired(f.cap)).toThrow(/^GOAL_LAUNCH_PAIR_CONFLICT$/);
    f.map.set(f.cap, input()); f.client.prepare('DELETE FROM audit_log WHERE id=?').run('opaque-admission');
    expect(() => f.writer.writeRequired(f.cap)).toThrow(/^GOAL_LAUNCH_PAIR_CONFLICT$/);
    expect(f.count()).toEqual({ n: 1 });
  });
  it('rolls back authorization when the actual second insert fails', () => {
    const f = fixture(); f.client.exec(`CREATE TRIGGER fail_admission BEFORE INSERT ON audit_log
      WHEN NEW.label='${admissionLabel}' BEGIN SELECT RAISE(ABORT, 'PRIVATE_SQL_ERROR'); END;`);
    expect(() => f.writer.writeRequired(f.cap)).toThrow(/^GOAL_LAUNCH_PAIR_STORAGE_ERROR$/);
    expect(f.count()).toEqual({ n: 0 });
    expect(f.reservations.readExact(parent)?.ids.childRunId).toBe('run');
  });
  it('rolls back both rows when SQLite changes saved bytes before required read-back', () => {
    const f = fixture(); f.client.exec(`CREATE TRIGGER corrupt_admission AFTER INSERT ON audit_log
      WHEN NEW.label='${admissionLabel}' BEGIN UPDATE audit_log SET data='{}' WHERE id=NEW.id; END;`);
    expect(() => f.writer.writeRequired(f.cap)).toThrow(/^GOAL_LAUNCH_PAIR_CONFLICT$/);
    expect(f.count()).toEqual({ n: 0 });
  });
  it('detaches returned refs and rejects reusing a capability for different host IDs', () => {
    const f = fixture(); const refs = f.writer.writeRequired(f.cap); refs.authorizationRef.id = 'mutated';
    expect(f.writer.writeRequired(f.cap).authorizationRef.id).toBe('opaque-auth');
    const changed = input(); changed.authorizationId = 'other-auth'; changed.admissionId = 'other-admission'; f.map.set(f.cap, changed);
    expect(() => f.writer.writeRequired(f.cap)).toThrow(/^GOAL_LAUNCH_PAIR_CONFLICT$/); expect(f.count()).toEqual({ n: 2 });
  });
  it('rejects foreign capabilities without accepting JSON-shaped claims', () => {
    const f = fixture(); expect(() => f.writer.writeRequired(input())).toThrow(/^GOAL_LAUNCH_PAIR_CAPABILITY$/);
    expect(f.count()).toEqual({ n: 0 });
  });
  it.each(['same-id', 'root', 'run', 'schema', 'binding', 'sequence', 'readmission', 'ref-injection'])('rejects malformed pair %s', kind => {
    const f = fixture(); const raw = input();
    if (kind === 'same-id') raw.admissionId = raw.authorizationId;
    if (['root', 'run', 'schema'].includes(kind)) Reflect.set(raw.admissionData, kind === 'root' ? 'rootSessionId' : `${kind}Id`, 'foreign');
    if (kind === 'binding') Reflect.set(raw.admissionData, 'binding', { stateRevision: 2, sourceVersion: 1, sourceFingerprint: hash });
    if (kind === 'sequence') Reflect.set(raw.admissionData, 'sequence', 1);
    if (kind === 'readmission') Reflect.set(raw.admissionData, 'admissionKind', 'readmission');
    if (kind === 'ref-injection') Reflect.set(raw.admissionData, 'authorizationRef', { id: 'foreign' });
    f.map.set(f.cap, raw); expect(() => f.writer.writeRequired(f.cap)).toThrow(/^GOAL_LAUNCH_PAIR_INVALID$/); expect(f.count()).toEqual({ n: 0 });
  });
  it('does not invoke captured accessors or proxy traps', () => {
    const f = fixture(); const raw = input(); const getter = vi.fn(() => 'PRIVATE');
    Object.defineProperty(raw.authorizationData, 'runId', { enumerable: true, get: getter }); f.map.set(f.cap, raw);
    expect(() => f.writer.writeRequired(f.cap)).toThrow(/^GOAL_LAUNCH_PAIR_INVALID$/); expect(getter).not.toHaveBeenCalled();
    const trap = vi.fn(() => { throw new Error('PRIVATE'); }); f.map.set(f.cap, new Proxy(input(), { ownKeys: trap }));
    expect(() => f.writer.writeRequired(f.cap)).toThrow(/^GOAL_LAUNCH_PAIR_INVALID$/); expect(trap).not.toHaveBeenCalled();
  });
  it('rejects Stop before writing without exposing its raw reason', () => {
    const f = fixture(); const controller = new AbortController(); controller.abort('PRIVATE');
    expect(() => f.writer.writeRequired(f.cap, controller.signal)).toThrow(/^GOAL_LAUNCH_PAIR_ABORTED$/); expect(f.count()).toEqual({ n: 0 });
  });
});
