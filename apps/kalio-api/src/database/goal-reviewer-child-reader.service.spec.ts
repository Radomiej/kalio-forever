import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { eq } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ArchitectureGoalReviewerRepository } from '../modules/architecture/architecture-goal-reviewer.repository';
import type { DrizzleService } from './drizzle.service';
import { GoalReviewerChildReaderService } from './goal-reviewer-child-reader.service';
import * as schema from './schema';

const clients: Database.Database[] = [];
afterEach(() => { for (const client of clients.splice(0)) client.close(); });
const unavailable = 'REVIEWER_CHILD_RESERVATION_UNAVAILABLE';

function fixture() {
  const sqlite = new Database(':memory:');
  clients.push(sqlite);
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: resolve(__dirname, 'migrations') });
  const now = new Date(1000);
  db.insert(schema.executionProfiles).values({ id: 'profile', name: 'Worker', kind: 'devin-cli-acp',
    model: 'exact-worker-model', createdAt: now, updatedAt: now }).run();
  db.insert(schema.projects).values({ id: 'project', name: 'Project', path: 'C:/isolated/workspace',
    kind: 'workspace', defaultExecutionProfileId: 'profile', createdAt: now, updatedAt: now }).run();
  db.insert(schema.personas).values({ id: 'persona', name: 'Worker', model: 'exact-worker-model',
    executionProfileId: 'profile', createdAt: now, updatedAt: now }).run();
  for (const id of ['root', 'worker']) db.insert(schema.sessions).values({ id, personaId: 'persona',
    kind: id === 'root' ? 'chat' : 'subagent', parentSessionId: id === 'root' ? null : 'root',
    projectId: 'project', executionProfileId: 'profile', createdAt: now, updatedAt: now,
    runtimeContext: { runtimeKind: id === 'root' ? 'chat' : 'subagent',
      architectureContext: { architectureRunId: 'goal-run' } } }).run();
  db.insert(schema.architectureGoalStates).values({ runId: 'goal-run', rootSessionId: 'root',
    stateRevision: 3, sourceVersion: 2, projectionStatus: 'accepted', sourceFingerprint: 'source',
    goalFingerprint: 'goal', packetJson: '{"version":2}', createdAt: 1000, updatedAt: 1000 }).run();
  db.insert(schema.messages).values({ id: 'prompt', sessionId: 'worker', role: 'user', content: 'Worker prompt',
    turnId: 'worker-turn', promptMessageId: 'prompt', createdAt: now }).run();
  db.insert(schema.messages).values({ id: 'terminal', sessionId: 'worker', role: 'assistant', content: 'Worker result',
    turnId: 'worker-turn', promptMessageId: 'prompt', createdAt: now }).run();
  db.insert(schema.chatRuns).values({ id: 'worker-run', sessionId: 'worker', turnId: 'worker-turn',
    status: 'completed', phase: 'completed', revision: 2, model: 'exact-worker-model', executionProfileId: 'profile',
    outcome: { messageId: 'terminal', finalText: 'Worker result' }, startedAt: now, lastHeartbeatAt: now,
    updatedAt: now, completedAt: now }).run();
  // The committed writer, not a reader-specific encoder, produces valid bytes.
  const writer = new ArchitectureGoalReviewerRepository(db);
  const result = writer.admit({ runId: 'goal-run', rootSessionId: 'root', expectedStateRevision: 3,
    reviewerPromptFingerprint: 'a'.repeat(64), worker: { chatRunId: 'worker-run', sessionId: 'worker',
      turnId: 'worker-turn', revision: 2, promptMessageId: 'prompt', terminalMessageId: 'terminal' } });
  if (result.kind !== 'inserted') throw new Error('Writer fixture did not admit');
  const reader = new GoalReviewerChildReaderService({ db } as unknown as DrizzleService);
  const read = () => reader.readByChildSessionId(result.admission.childSessionId);
  const unchanged = (operation: () => unknown) => {
    const before = sqlite.prepare('SELECT total_changes() AS n').get();
    try { return operation(); }
    finally { expect(sqlite.prepare('SELECT total_changes() AS n').get()).toEqual(before); }
  };
  const rewriteDescriptor = (mutate: (descriptor: Record<string, unknown>) => void) => {
    sqlite.exec('DROP TRIGGER IF EXISTS goal_reviewer_transition');
    const descriptor = JSON.parse(result.admission.descriptorJson) as Record<string, unknown>;
    mutate(descriptor);
    const json = JSON.stringify(descriptor);
    db.update(schema.goalReviewerAdmissions).set({ descriptorJson: json,
      descriptorSha256: createHash('sha256').update(json, 'utf8').digest('hex') }).run();
  };
  return { sqlite, db, reader, result, writer, read, unchanged, rewriteDescriptor };
}

describe('unwired authoritative reserved-child classifier (real SQLite)', () => {
  it('returns only metadata from writer-produced admission with zero writes', () => {
    const f = fixture();
    expect(f.unchanged(f.read)).toEqual({ admissionId: f.result.admission.admissionId,
      descriptorSha256: f.result.admission.descriptorSha256, childSessionId: f.result.admission.childSessionId,
      plannedTurnId: f.result.admission.plannedTurnId, rootSessionId: 'root', parentSessionId: 'root',
      parentToolCallId: `goal-reviewer:${f.result.admission.admissionId}`, state: 'admitted', revision: 0 });
    expect(Object.isFrozen(f.read())).toBe(true);
  });

  it('returns null only for successful unreserved lookup, without marker authority', () => {
    const f = fixture();
    expect(f.unchanged(() => f.reader.readByChildSessionId('worker'))).toBeNull();
    expect(f.unchanged(() => f.reader.readByChildSessionId('absent'))).toBeNull();
  });

  it.each(['started', 'cancelled'] as const)('classifies %s without reminting', state => {
    const f = fixture();
    if (state === 'started') expect(f.result.claimStart()).toBe(true);
    else expect(f.writer.cancelAdmitted(f.result.admission.admissionId, f.result.admission.descriptorSha256)).toBe(true);
    expect(f.unchanged(f.read)).toMatchObject({ state, revision: 1 });
  });

  it('preserves deleted-child tombstones as unavailable', () => {
    const f = fixture();
    f.db.delete(schema.sessions).where(eq(schema.sessions.id, f.result.admission.childSessionId)).run();
    expect(() => f.unchanged(f.read)).toThrow(unavailable);
  });

  it.each(['parent_session_id', 'parent_tool_call_id', 'parent_turn_id', 'execution_profile_id',
    'project_id', 'persona_id', 'kind', 'created_at'])('rejects actual child %s mismatch', column => {
    const f = fixture();
    // Disable constraints only to model corrupted stored rows, never in production.
    f.sqlite.pragma('foreign_keys = OFF');
    f.sqlite.prepare(`UPDATE sessions SET ${column} = ? WHERE id = ?`)
      .run(column === 'created_at' ? 1001 : 'wrong', f.result.admission.childSessionId);
    expect(() => f.unchanged(f.read)).toThrow(unavailable);
  });

  it.each(['childSessionId', 'plannedTurnId', 'createdAt', 'binding', 'version', 'root', 'profile', 'worker', 'input'])(
    'rejects rehashed malformed/mismatched descriptor %s', field => {
      const f = fixture();
      f.rewriteDescriptor(d => {
        if (['childSessionId', 'plannedTurnId', 'createdAt', 'binding'].includes(field)) d[field] = 'wrong';
        else {
          const binding = d.binding as Record<string, unknown>;
          binding[field] = field === 'version' ? 2 : null;
        }
      });
      expect(() => f.unchanged(f.read)).toThrow(unavailable);
    });

  it.each(['digest', 'json', 'state', 'revision', 'root', 'turn'])('fails closed on corrupt %s', field => {
    const f = fixture();
    f.sqlite.exec('DROP TRIGGER goal_reviewer_transition');
    f.sqlite.pragma('ignore_check_constraints = ON');
    const updates: Record<string, string | number> = { digest: 'descriptor_sha256', json: 'descriptor_json',
      state: 'state', revision: 'revision', root: 'root_session_id', turn: 'planned_turn_id' };
    f.sqlite.prepare(`UPDATE goal_reviewer_admissions SET ${updates[field]} = ?`)
      .run(field === 'revision' ? 2 : field === 'json' ? '{private-payload' : 'wrong');
    expect(() => f.unchanged(f.read)).toThrow(/^REVIEWER_CHILD_RESERVATION_UNAVAILABLE$/);
  });

  it('hashes original UTF8 bytes, not parsed/reencoded JSON', () => {
    const f = fixture();
    f.sqlite.exec('DROP TRIGGER goal_reviewer_transition');
    const json = ` \n${f.result.admission.descriptorJson}\n`;
    f.db.update(schema.goalReviewerAdmissions).set({ descriptorJson: json,
      descriptorSha256: createHash('sha256').update(json, 'utf8').digest('hex') }).run();
    expect(f.unchanged(f.read)).toMatchObject({ childSessionId: f.result.admission.childSessionId });
    f.db.update(schema.goalReviewerAdmissions).set({ descriptorSha256: f.result.admission.descriptorSha256 }).run();
    expect(() => f.unchanged(f.read)).toThrow(unavailable);
  });

  it('does not claim fresh binding validation or use child runtimeContext as authority', () => {
    const f = fixture();
    f.db.update(schema.sessions).set({ runtimeContext: null })
      .where(eq(schema.sessions.id, f.result.admission.childSessionId)).run();
    f.db.update(schema.executionProfiles).set({ model: 'changed' }).run();
    expect(f.unchanged(f.read)).not.toBeNull();
    expect(f.result.claimStart()).toBe(false);
  });

  it('does not hide missing schema/read failure behind null, even for absent IDs', () => {
    const f = fixture();
    f.sqlite.exec('DROP TABLE goal_reviewer_admissions');
    expect(() => f.unchanged(() => f.reader.readByChildSessionId('absent'))).toThrow(unavailable);
  });

  it.each([['admitted', 1], ['started', 0], ['cancelled', 0], ['unknown', 1]])(
    'rejects unsupported state/revision %s/%s', (state, revision) => {
      const f = fixture();
      f.sqlite.exec('DROP TRIGGER goal_reviewer_transition');
      f.sqlite.pragma('ignore_check_constraints = ON');
      f.sqlite.prepare('UPDATE goal_reviewer_admissions SET state = ?, revision = ?').run(state, revision);
      expect(() => f.unchanged(f.read)).toThrow(unavailable);
    });

  it.each(['', '  ', null, 42])('fails closed on invalid lookup input %s', input => {
    const f = fixture();
    expect(() => f.unchanged(() => f.reader.readByChildSessionId(input as string))).toThrow(unavailable);
  });

  it('works under SQLite query_only and leaves database bytes unchanged', () => {
    const f = fixture();
    const before = f.sqlite.serialize();
    f.sqlite.pragma('query_only = ON');
    expect(f.unchanged(f.read)).not.toBeNull();
    expect(f.sqlite.serialize()).toEqual(before);
  });

  it('returns static failure on a closed database', () => {
    const f = fixture();
    f.sqlite.close();
    clients.splice(clients.indexOf(f.sqlite), 1);
    expect(() => f.read()).toThrow(/^REVIEWER_CHILD_RESERVATION_UNAVAILABLE$/);
  });
});
