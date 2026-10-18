import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { resolve } from 'node:path';
import { afterEach, describe, expect, expectTypeOf, it } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import type { SqliteMutationResult } from './sqlite-runtime';
import * as schema from './schema';
import { sessionTreeStopAdmission } from './session-tree-stop-admission';

const clients: Database.Database[] = [];
afterEach(() => clients.splice(0).forEach(client => client.close()));

function fixture() {
  const client = new Database(':memory:');
  clients.push(client);
  client.pragma('foreign_keys = ON');
  const db = drizzle(client, { schema });
  migrate(db, { migrationsFolder: resolve(__dirname, 'migrations') });
  client.exec(`INSERT INTO personas(id,name,model,created_at,updated_at) VALUES ('p','Test','mock',1,1);
    INSERT INTO sessions(id,persona_id,parent_session_id,created_at,updated_at) VALUES
    ('root','p',NULL,1,1),('child','p','root',1,1),('leaf','p','child',1,1),('other','p',NULL,1,1);`);
  return { db, client, admission: sessionTreeStopAdmission(db) };
}

describe('session tree topology freeze (real migrated SQLite)', () => {
  it('shares claim ownership by database identity, not service instance', () => {
    const f = fixture();
    const claim = f.admission.claim('root');
    try {
      expect(() => sessionTreeStopAdmission(f.db).runIfAdmitted('leaf', () => ({ changes: 1 }))).toThrow('SESSION_TREE_STOP_IN_PROGRESS');
    } finally { claim.release(); }
    expect(f.admission.runIfAdmitted('leaf', () => ({ changes: 1 }))).toEqual({ changes: 1 });
  });

  it.each(['root', 'child', 'leaf'])('rejects overlapping claim %s without replacing the original', id => {
    const f = fixture();
    const claim = f.admission.claim('child');
    try {
      expect(() => f.admission.claim(id)).toThrow('SESSION_TREE_STOP_IN_PROGRESS');
      expect(() => f.admission.runIfAdmitted('leaf', () => ({ changes: 1 }))).toThrow('SESSION_TREE_STOP_IN_PROGRESS');
    } finally { claim.release(); }
    const retry = f.admission.claim(id);
    retry.release();
  });

  it('allows disjoint stop and does not expand a child claim to its parent or sibling', () => {
    const f = fixture();
    const child = f.admission.claim('child');
    const other = f.admission.claim('other');
    try {
      expect(f.admission.runIfAdmitted('root', () => ({ changes: 1 }))).toEqual({ changes: 1 });
      expect(f.admission.runIfAdmitted(undefined, () => ({ changes: 1 }))).toEqual({ changes: 1 });
    } finally { child.release(); other.release(); }
  });

  it('blocks the actual insert under a frozen descendant and allows it only after release', () => {
    const f = fixture();
    const insert = () => f.admission.runIfAdmitted('leaf', () => f.db.insert(schema.sessions).values({
      id: 'new-child', personaId: 'p', title: 'New', parentSessionId: 'leaf', createdAt: new Date(1), updatedAt: new Date(1),
    }).run());
    const claim = f.admission.claim('root');
    expect(insert).toThrow('SESSION_TREE_STOP_IN_PROGRESS');
    expect(f.client.prepare('SELECT count(*) AS n FROM sessions WHERE id=?').get('new-child')).toEqual({ n: 0 });
    claim.release();
    insert();
    expect(f.client.prepare('SELECT parent_session_id AS parent FROM sessions WHERE id=?').get('new-child')).toEqual({ parent: 'leaf' });
  });

  it('release is idempotent and an old release cannot remove a later claim', () => {
    const f = fixture();
    const first = f.admission.claim('root');
    first.release();
    first.release();
    const next = f.admission.claim('root');
    first.release();
    expect(() => f.admission.runIfAdmitted('child', () => ({ changes: 1 }))).toThrow('SESSION_TREE_STOP_IN_PROGRESS');
    next.release();
    expect(f.admission.runIfAdmitted('child', () => ({ changes: 1 }))).toEqual({ changes: 1 });
  });

  it('does not share claims across isolated databases', () => {
    const a = fixture(); const b = fixture();
    const claim = a.admission.claim('root');
    try { expect(b.admission.runIfAdmitted('leaf', () => ({ changes: 1 }))).toEqual({ changes: 1 }); }
    finally { claim.release(); }
  });

  it('fails closed for missing or cyclic persisted ancestry', () => {
    const f = fixture();
    expect(() => f.admission.claim('missing')).toThrow(NotFoundException);
    f.client.prepare('UPDATE sessions SET parent_session_id=? WHERE id=?').run('leaf', 'root');
    expect(() => f.admission.claim('root')).toThrow('SESSION_TREE_ANCESTRY_INVALID');
    expect(() => f.admission.runIfAdmitted('child', () => ({ changes: 1 }))).toThrow('SESSION_TREE_ANCESTRY_INVALID');
  });

  it('exposes a typed conflict response, not only a display message', () => {
    const f = fixture(); const claim = f.admission.claim('root');
    try {
      let failure: unknown;
      try { f.admission.claim('child'); } catch (error) { failure = error; }
      expect(failure).toBeInstanceOf(ConflictException);
      if (!(failure instanceof ConflictException)) throw new Error('Expected a conflict');
      expect(failure.getStatus()).toBe(409);
      expect(failure.getResponse()).toMatchObject({ code: 'SESSION_TREE_STOP_IN_PROGRESS' });
    } finally { claim.release(); }
  });

  it('requires the existing synchronous SQLite result contract at the callback boundary', () => {
    type Mutation = Parameters<ReturnType<typeof sessionTreeStopAdmission>['runIfAdmitted']>[1];
    expectTypeOf<Mutation>().returns.toEqualTypeOf<SqliteMutationResult>();
    expectTypeOf<() => Promise<SqliteMutationResult>>().not.toMatchTypeOf<Mutation>();
  });
});
