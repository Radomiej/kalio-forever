import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../../database/schema';
import { createGoalLaunchReservationStore, requireGoalLaunchReservationExact, type GoalLaunchReservedIds } from './goal-launch-reservation';

const clients: Database.Database[] = []; const dirs: string[] = [];
afterEach(() => { clients.splice(0).forEach(c => { if (c.open) c.close(); });
  dirs.splice(0).forEach(d => rmSync(d, { recursive: true, force: true })); });
const parent = { parentRunId: 'parent-run', parentSessionId: 'HOST', parentTurnId: 'turn', promptMessageId: 'prompt', callId: 'call' };
const descriptor = { version: 1, flowDefinitionId: 'flow', schemaId: 'schema', startMode: 'durable',
  vfsMode: 'isolated', returnMode: 'summary', copyBack: false, maxSteps: null,
  argsSha256: 'a'.repeat(64), sourceContentSha256: 'b'.repeat(64),
  schemaDefinitionSha256: 'c'.repeat(64), flowDefinitionSha256: 'd'.repeat(64) };
const ids: GoalLaunchReservedIds = { childRunId: 'child', rootSessionId: 'internal-root', authorizationId: 'auth', admissionId: 'admission' };
function fixture(path = ':memory:') {
  const client = new Database(path); clients.push(client); client.pragma('foreign_keys = ON'); client.pragma('journal_mode = WAL');
  const db = drizzle(client, { schema });
  migrate(db, { migrationsFolder: resolve(__dirname, '../../database/migrations') });
  client.prepare(`INSERT OR IGNORE INTO chat_runs (id,session_id,turn_id,phase,status,started_at,updated_at,last_heartbeat_at)
    VALUES ('parent-run','HOST','turn','running','running',1,1,1)`).run();
  const allocate = vi.fn(() => ({ ...ids }));
  return { client, db, allocate, store: createGoalLaunchReservationStore(db, allocate) };
}
function disk() { const dir = mkdtempSync(join(tmpdir(), 'kalio-launch-reserve-')); dirs.push(dir); return join(dir, 'test.db'); }

describe('immutable goal launch reservation (real SQLite)', () => {
  it('closed exact read uses caller transaction state and leaves its rollback ownership with the caller', () => {
    const f = fixture(); const saved = f.store.reserve(parent, descriptor);
    const claim = { parent, descriptor, descriptorSha256: saved.descriptorSha256 };
    expect(f.db.transaction(tx => requireGoalLaunchReservationExact(tx, claim, ids))).toEqual(saved);
    expect(() => f.db.transaction(tx => {
      tx.run("UPDATE chat_runs SET turn_id='uncommitted' WHERE id='parent-run'");
      requireGoalLaunchReservationExact(tx, claim, ids);
    })).toThrow('GOAL_LAUNCH_RESERVATION_PARENT');
    expect(f.store.readExact(parent)).toEqual(saved);
  });
  it('closed exact read recomputes canonical hash and rejects detached forged IDs or getters', () => {
    const f = fixture(); const saved = f.store.reserve(parent, descriptor);
    const claim = { parent, descriptor, descriptorSha256: saved.descriptorSha256 };
    expect(() => f.db.transaction(tx => requireGoalLaunchReservationExact(tx, claim, { ...ids, admissionId: 'foreign' }))).toThrow('GOAL_LAUNCH_RESERVATION_CONFLICT');
    const getter = vi.fn(() => 'RAW_SECRET'); const value = { ...claim };
    Object.defineProperty(value, 'descriptor', { enumerable: true, get: getter });
    expect(() => f.db.transaction(tx => requireGoalLaunchReservationExact(tx, value, ids))).toThrow('GOAL_LAUNCH_RESERVATION_INVALID');
    expect(getter).not.toHaveBeenCalled();
  });
  it('migration creates only the parent FK and immutable composite-key mapping', () => {
    const f = fixture(); const fks = f.client.prepare('PRAGMA foreign_key_list(goal_launch_reservations)').all();
    expect(fks).toEqual([expect.objectContaining({ table: 'chat_runs', from: 'parent_run_id', to: 'id', on_delete: 'RESTRICT' })]);
    const columns = f.client.prepare('PRAGMA table_info(goal_launch_reservations)').all() as { name: string; pk: number }[];
    expect(columns.filter(c => c.pk).map(c => c.name)).toEqual(['parent_run_id', 'parent_session_id', 'parent_turn_id', 'prompt_message_id', 'call_id']);
    f.store.reserve(parent, descriptor);
    expect(() => f.client.exec("UPDATE goal_launch_reservations SET child_run_id='replacement'")).toThrow();
    expect(() => f.client.exec('DELETE FROM goal_launch_reservations')).toThrow();
  });
  it('canonicalizes field order, stores only allocation metadata and digests, and returns detached winning IDs', () => {
    const f = fixture(); const first = f.store.reserve(parent, descriptor);
    const reversed = Object.fromEntries(Object.entries(descriptor).reverse());
    expect(f.store.reserve(parent, reversed)).toEqual(first); expect(f.allocate).toHaveBeenCalledTimes(1);
    expect(first.ids).toEqual(ids);
    expect(first.descriptorJson).toBe(JSON.stringify(descriptor));
    expect(first.descriptorSha256).toBe(createHash('sha256').update(JSON.stringify(descriptor), 'utf8').digest('hex'));
    first.ids.childRunId = 'mutated';
    expect(f.store.readExact(parent)?.ids.childRunId).toBe('child');
    const row = f.client.prepare('SELECT * FROM goal_launch_reservations').get();
    expect(JSON.stringify(row)).not.toContain('RAW_SECRET');
    expect(Object.keys(row as object)).not.toContain('args');
  });
  it('recreated producers and reopened databases never allocate again', () => {
    const path = disk(); const f = fixture(path); const saved = f.store.reserve(parent, descriptor); f.client.close();
    const reopened = fixture(path); expect(reopened.store.reserve(parent, descriptor)).toEqual(saved);
    expect(reopened.allocate).not.toHaveBeenCalled();
  });
  it('different descriptor conflicts without selecting replacement IDs', () => {
    const f = fixture(); f.store.reserve(parent, descriptor);
    expect(() => f.store.reserve(parent, { ...descriptor, argsSha256: 'c'.repeat(64) })).toThrow('GOAL_LAUNCH_RESERVATION_CONFLICT');
    expect(f.allocate).toHaveBeenCalledTimes(1);
  });
  it.each(['schemaDefinitionSha256', 'flowDefinitionSha256'])('binds changed host %s under the same definition IDs', field => {
    const f = fixture(); const bound = { ...descriptor, schemaDefinitionSha256: 'c'.repeat(64), flowDefinitionSha256: 'd'.repeat(64) };
    const saved = f.store.reserve(parent, bound);
    expect(() => f.store.reserve(parent, { ...bound, [field]: 'e'.repeat(64) })).toThrow('GOAL_LAUNCH_RESERVATION_CONFLICT');
    expect(f.store.readExact(parent)).toEqual(saved); expect(f.allocate).toHaveBeenCalledTimes(1);
  });
  it('requires exact durable parent run/session/turn even for existing mappings', () => {
    const f = fixture(); expect(f.store.readExact(parent)).toBeNull();
    for (const change of [{ parentRunId: 'missing' }, { parentSessionId: 'foreign' }, { parentTurnId: 'foreign' }]) {
      expect(() => f.store.reserve({ ...parent, ...change }, descriptor)).toThrow('GOAL_LAUNCH_RESERVATION_PARENT');
    }
    expect(f.allocate).not.toHaveBeenCalled(); f.store.reserve(parent, descriptor);
    f.client.exec("UPDATE chat_runs SET turn_id='changed' WHERE id='parent-run'");
    expect(() => f.store.readExact(parent)).toThrow('GOAL_LAUNCH_RESERVATION_PARENT');
  });
  it('audit clear and session/message deletion leave journal plus reservation; parent deletion is restricted', () => {
    const f = fixture(); const saved = f.store.reserve(parent, descriptor);
    f.client.exec(`INSERT INTO personas(id,name,model,created_at,updated_at) VALUES ('test-persona','test','test',1,1);
      INSERT INTO sessions(id,persona_id,title,created_at,updated_at) VALUES ('HOST','test-persona','title',1,1);
      INSERT INTO messages(id,session_id,role,content,created_at) VALUES ('prompt','HOST','user','RAW_SECRET',1);
      DELETE FROM audit_log; DELETE FROM audit_log_archive; DELETE FROM sessions WHERE id='HOST';`);
    expect(f.client.prepare("SELECT id FROM messages WHERE id='prompt'").get()).toBeUndefined();
    expect(f.store.reserve(parent, descriptor)).toEqual(saved);
    expect(() => f.client.exec("DELETE FROM chat_runs WHERE id='parent-run'")).toThrow(/FOREIGN KEY/);
  });
  it('INSERT OR REPLACE cannot bypass immutability with recursive triggers disabled', () => {
    const f = fixture(); f.store.reserve(parent, descriptor); f.client.pragma('recursive_triggers = OFF');
    expect(() => f.client.exec(`INSERT OR REPLACE INTO goal_launch_reservations
      SELECT parent_run_id,parent_session_id,parent_turn_id,prompt_message_id,call_id,'replacement',
      root_session_id,authorization_id,admission_id,descriptor_version,descriptor_json,descriptor_sha256,created_at
      FROM goal_launch_reservations`)).toThrow();
    expect(f.store.readExact(parent)?.ids.childRunId).toBe('child');
  });
  it('insert failure rolls back and never leaves a partial mapping', () => {
    const f = fixture(); f.client.exec(`CREATE TRIGGER fail_reserve AFTER INSERT ON goal_launch_reservations
      BEGIN SELECT RAISE(ABORT,'RAW_SECRET'); END;`);
    expect(() => f.store.reserve(parent, descriptor)).toThrow('GOAL_LAUNCH_RESERVATION_STORAGE');
    expect(f.store.readExact(parent)).toBeNull();
    f.client.exec('DROP TRIGGER fail_reserve'); expect(f.store.reserve(parent, descriptor).ids).toEqual(ids);
  });
  it('Stop after ID allocation rolls back; later Stop and preparation failure do not release a committed mapping', () => {
    const f = fixture(); const controller = new AbortController();
    const store = createGoalLaunchReservationStore(f.db, () => { controller.abort('RAW_SECRET'); return ids; });
    expect(() => store.reserve(parent, descriptor, controller.signal)).toThrow('GOAL_LAUNCH_RESERVATION_ABORTED');
    expect(f.store.readExact(parent)).toBeNull(); const saved = f.store.reserve(parent, descriptor);
    expect(() => f.store.reserve(parent, descriptor, controller.signal)).toThrow('GOAL_LAUNCH_RESERVATION_ABORTED');
    expect(f.store.readExact(parent)).toEqual(saved);
  });
  it('two connections contend at BEGIN IMMEDIATE before the loser can allocate, then recover winner', () => {
    const path = disk(); const a = fixture(path); const b = fixture(path); b.client.pragma('busy_timeout = 0');
    const winner = createGoalLaunchReservationStore(a.db, () => {
      expect(() => b.store.reserve(parent, descriptor)).toThrow('GOAL_LAUNCH_RESERVATION_STORAGE');
      expect(b.allocate).not.toHaveBeenCalled(); return ids;
    }).reserve(parent, descriptor);
    expect(b.store.reserve(parent, descriptor)).toEqual(winner); expect(b.allocate).not.toHaveBeenCalled();
    expect(a.client.prepare('SELECT count(*) AS n FROM goal_launch_reservations').get()).toEqual({ n: 1 });
  });
  it.each([
    { ...descriptor, prompt: 'RAW_SECRET' }, { ...descriptor, args: { secret: 'RAW_SECRET' } },
    { ...descriptor, version: 2 }, { ...descriptor, argsSha256: 'RAW_SECRET' },
    { ...descriptor, maxSteps: NaN }, { ...descriptor, maxSteps: 51 },
    { ...descriptor, copyBack: 'false' }, { ...descriptor, startMode: 'other' },
    { ...descriptor, schemaDefinitionSha256: 'RAW_SECRET' }, { ...descriptor, flowDefinitionSha256: null },
  ])('rejects malformed/content-bearing descriptors before allocation', value => {
    const f = fixture(); expect(() => f.store.reserve(parent, value)).toThrow('GOAL_LAUNCH_RESERVATION_INVALID');
    expect(f.allocate).not.toHaveBeenCalled();
  });
  it('rejects getters and proxies without invoking them', () => {
    const f = fixture(); const getter = vi.fn(() => 'RAW_SECRET'); const value = { ...descriptor };
    Object.defineProperty(value, 'argsSha256', { enumerable: true, get: getter });
    expect(() => f.store.reserve(parent, value)).toThrow('GOAL_LAUNCH_RESERVATION_INVALID');
    const trap = vi.fn(() => []); const proxy = new Proxy(descriptor, { ownKeys: trap });
    expect(() => f.store.reserve(parent, proxy)).toThrow('GOAL_LAUNCH_RESERVATION_INVALID');
    expect(getter).not.toHaveBeenCalled(); expect(trap).not.toHaveBeenCalled();
  });
  it('does not coerce nested descriptor values or accept missing definition hashes', () => {
    const f = fixture(); const coerce = vi.fn(() => 'durable');
    expect(() => f.store.reserve(parent, { ...descriptor, startMode: { toString: coerce } })).toThrow('GOAL_LAUNCH_RESERVATION_INVALID');
    expect(coerce).not.toHaveBeenCalled();
    const { schemaDefinitionSha256: _schema, flowDefinitionSha256: _flow, ...unbound } = descriptor;
    expect(() => f.store.reserve(parent, unbound)).toThrow('GOAL_LAUNCH_RESERVATION_INVALID');
    expect(f.allocate).not.toHaveBeenCalled();
  });
});
