import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import * as schema from '../../database/schema';
import { sessionTreeStopAdmission } from '../../database/session-tree-stop-admission';
import { ArchitectureGoalReviewerRepository, type ReviewerAdmissionInput } from './architecture-goal-reviewer.repository';

const cleanups: (() => void)[] = [];
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); });

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'kalio-reviewer-admission-'));
  const path = join(directory, 'isolated.db');
  const first = new Database(path);
  first.pragma('foreign_keys = ON');
  first.pragma('journal_mode = WAL');
  const db = drizzle(first, { schema });
  migrate(db, { migrationsFolder: resolve(__dirname, '../../database/migrations') });
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
    runtimeContext: { runtimeKind: id === 'root' ? 'chat' : 'subagent', architectureContext: { architectureRunId: 'goal-run' } } }).run();
  db.insert(schema.architectureGoalStates).values({ runId: 'goal-run', rootSessionId: 'root',
    stateRevision: 3, sourceVersion: 2, projectionStatus: 'accepted', sourceFingerprint: 'source',
    goalFingerprint: 'goal', packetJson: '{"version":2}', createdAt: 1000, updatedAt: 1000 }).run();
  db.insert(schema.messages).values({ id: 'prompt', sessionId: 'worker', role: 'user', content: 'Worker prompt',
    turnId: 'worker-turn', promptMessageId: 'prompt', createdAt: now }).run();
  db.insert(schema.messages).values({ id: 'terminal', sessionId: 'worker', role: 'assistant', content: 'Worker result',
    turnId: 'worker-turn', promptMessageId: 'prompt', createdAt: now }).run();
  db.insert(schema.chatRuns).values({ id: 'worker-run', sessionId: 'worker', turnId: 'worker-turn',
    status: 'completed', phase: 'completed', revision: 2, model: 'exact-worker-model', executionProfileId: 'profile',
    outcome: { messageId: 'terminal', finalText: 'Worker result' }, startedAt: now, lastHeartbeatAt: now, updatedAt: now, completedAt: now }).run();
  const second = new Database(path);
  second.pragma('foreign_keys = ON');
  second.pragma('busy_timeout = 30');
  const other = drizzle(second, { schema });
  cleanups.push(() => { second.close(); first.close(); rmSync(directory, { recursive: true, force: true }); });
  const input: ReviewerAdmissionInput = { runId: 'goal-run', rootSessionId: 'root', expectedStateRevision: 3,
    reviewerPromptFingerprint: 'a'.repeat(64), worker: { chatRunId: 'worker-run', sessionId: 'worker',
      turnId: 'worker-turn', revision: 2, promptMessageId: 'prompt', terminalMessageId: 'terminal' } };
  return { first, second, db, input, repo: new ArchitectureGoalReviewerRepository(db),
    other: new ArchitectureGoalReviewerRepository(other), stop: sessionTreeStopAdmission(db) };
}

describe('durable reviewer admission (isolated real SQLite)', () => {
  it('commits real child plus binding; another connection gets no invocation capability', () => {
    const f = fixture();
    const winner = f.repo.admit(f.input);
    expect(winner.kind).toBe('inserted');
    if (winner.kind !== 'inserted') throw new Error('Expected insert');
    expect(f.second.prepare('SELECT parent_session_id, execution_profile_id FROM sessions WHERE id = ?')
      .get(winner.admission.childSessionId)).toEqual({ parent_session_id: 'root', execution_profile_id: 'profile' });
    const duplicate = f.other.admit(f.input);
    expect(duplicate.kind).toBe('existing');
    expect('claimStart' in duplicate).toBe(false);
    expect(winner.claimStart()).toBe(true);
    expect(winner.claimStart()).toBe(false);
    expect(f.second.prepare('SELECT state, revision FROM goal_reviewer_admissions').get()).toEqual({ state: 'started', revision: 1 });
    expect(f.first.prepare('SELECT count(*) AS n FROM chat_runs').get()).toEqual({ n: 1 });
  });

  it('resolves logical identity conflicts even when random admission IDs differ', () => {
    const f = fixture();
    expect(f.repo.admit(f.input).kind).toBe('inserted');
    expect(f.other.admit({ ...f.input, reviewerPromptFingerprint: 'b'.repeat(64) }).kind).toBe('unavailable');
    expect(f.first.prepare('SELECT count(*) AS n FROM goal_reviewer_admissions').get()).toEqual({ n: 1 });
    expect(f.first.prepare('SELECT count(*) AS n FROM sessions').get()).toEqual({ n: 3 });
  });

  it('canonicalizes locator property order to prevent a duplicate identity', () => {
    const f = fixture();
    expect(f.repo.admit(f.input).kind).toBe('inserted');
    const w = f.input.worker;
    expect(f.other.admit({ ...f.input, worker: { terminalMessageId: w.terminalMessageId,
      promptMessageId: w.promptMessageId, revision: w.revision, turnId: w.turnId,
      sessionId: w.sessionId, chatRunId: w.chatRunId } }).kind).toBe('existing');
  });

  it('rolls child insertion back if admission insertion fails', () => {
    const f = fixture();
    f.first.exec("CREATE TRIGGER injected_failure BEFORE INSERT ON goal_reviewer_admissions BEGIN SELECT RAISE(ABORT, 'test'); END");
    expect(f.repo.admit(f.input).kind).toBe('unavailable');
    expect(f.second.prepare('SELECT count(*) AS n FROM sessions').get()).toEqual({ n: 2 });
    expect(f.second.prepare('SELECT count(*) AS n FROM goal_reviewer_admissions').get()).toEqual({ n: 0 });
  });

  it('refuses an outer transaction without rolling back foreign changes', () => {
    const f = fixture();
    f.first.exec('BEGIN IMMEDIATE');
    f.first.exec("UPDATE sessions SET title = 'foreign' WHERE id = 'root'");
    expect(f.repo.admit(f.input).kind).toBe('unavailable');
    expect(f.first.inTransaction).toBe(true);
    f.first.exec('COMMIT');
    expect(f.second.prepare("SELECT title FROM sessions WHERE id = 'root'").get()).toEqual({ title: 'foreign' });
  });

  it('fails closed under another writer lock, then admits only one winner', () => {
    const f = fixture();
    f.first.exec('BEGIN IMMEDIATE');
    expect(f.other.admit(f.input).kind).toBe('unavailable');
    f.first.exec('ROLLBACK');
    expect(f.repo.admit(f.input).kind).toBe('inserted');
    expect(f.other.admit(f.input).kind).toBe('existing');
  });

  it('respects existing local tree-stop fence without publishing a child', () => {
    const f = fixture(); const stop = f.stop.claim('root');
    try { expect(f.repo.admit(f.input).kind).toBe('unavailable'); } finally { stop.release(); }
    expect(f.first.prepare('SELECT count(*) AS n FROM sessions').get()).toEqual({ n: 2 });
  });

  for (const change of [
    "UPDATE architecture_goal_states SET state_revision = 4",
    "UPDATE architecture_goal_states SET packet_json = '{\"version\":999}'",
    "UPDATE messages SET content = 'changed' WHERE id = 'terminal'",
    "UPDATE messages SET prompt_message_id = 'other' WHERE id = 'terminal'",
    "UPDATE chat_runs SET revision = 3",
    "UPDATE execution_profiles SET model = 'other'",
    "UPDATE execution_profiles SET enabled = 0",
    "INSERT INTO app_settings VALUES ('devin.cli.native-tools', '{}', 1001)",
    "INSERT INTO app_settings VALUES ('devin.cli.native-tools', 'null', 1001)",
    "UPDATE architecture_goal_states SET evidence_inventory_json = 'null'",
    "UPDATE architecture_goal_states SET completion_authorization_json = 'null'",
  ]) it(`revalidates before start: ${change}`, () => {
    const f = fixture(); const result = f.repo.admit(f.input);
    if (result.kind !== 'inserted') throw new Error('Expected insert');
    f.second.exec(change);
    expect(result.claimStart()).toBe(false);
    expect(f.first.prepare('SELECT state FROM goal_reviewer_admissions').get()).toEqual({ state: 'admitted' });
  });

  it('cancellation wins CAS and cannot be undone by start or reopen', () => {
    const f = fixture(); const result = f.repo.admit(f.input);
    if (result.kind !== 'inserted') throw new Error('Expected insert');
    expect(f.other.cancelAdmitted(result.admission.admissionId, result.admission.descriptorSha256)).toBe(true);
    expect(result.claimStart()).toBe(false);
    expect(f.repo.cancelAdmitted(result.admission.admissionId, result.admission.descriptorSha256)).toBe(false);
    expect(f.other.admit(f.input).kind).toBe('existing');
    expect(f.second.prepare('SELECT state, revision FROM goal_reviewer_admissions').get()).toEqual({ state: 'cancelled', revision: 1 });
  });

  it('start wins CAS; cancellation does not claim a running child stopped', () => {
    const f = fixture(); const result = f.repo.admit(f.input);
    if (result.kind !== 'inserted') throw new Error('Expected insert');
    expect(result.claimStart()).toBe(true);
    expect(f.other.cancelAdmitted(result.admission.admissionId, result.admission.descriptorSha256)).toBe(false);
  });

  it('a newly opened connection cannot resume an orphan admitted row', () => {
    const f = fixture(); expect(f.repo.admit(f.input).kind).toBe('inserted');
    const path = f.first.name;
    const reopened = new Database(path);
    try {
      reopened.pragma('foreign_keys = ON');
      const result = new ArchitectureGoalReviewerRepository(drizzle(reopened, { schema })).admit(f.input);
      expect(result.kind).toBe('existing'); expect('claimStart' in result).toBe(false);
    } finally { reopened.close(); }
  });

  for (const column of ['admission_id', 'child_session_id', 'planned_turn_id', 'logical'])
    it(`rejects replacement across ${column} identity`, () => {
      const f = fixture(); expect(f.repo.admit(f.input).kind).toBe('inserted');
      const row = f.first.prepare('SELECT * FROM goal_reviewer_admissions').get() as Record<string, unknown>;
      const changed: Record<string, unknown> = { ...row, admission_id: 'new-id', planned_turn_id: 'new-turn' };
      if (column === 'admission_id') changed.admission_id = String(row.admission_id);
      if (column !== 'child_session_id') {
        // Use a different existing child FK to isolate other unique keys.
        changed.child_session_id = 'worker';
      }
      if (column === 'planned_turn_id') changed.planned_turn_id = String(row.planned_turn_id);
      if (column !== 'logical') changed.worker_fingerprint = 'different-worker';
      const names = Object.keys(changed);
      expect(() => f.first.prepare(`INSERT OR REPLACE INTO goal_reviewer_admissions (${names.join(',')}) VALUES (${names.map(() => '?').join(',')})`)
        .run(...Object.values(changed))).toThrow(/REVIEWER_ADMISSION_DUPLICATE/);
      expect(f.first.prepare('SELECT count(*) AS n FROM goal_reviewer_admissions').get()).toEqual({ n: 1 });
    });

  it('rejects UPSERT, mutation, admission deletion and noninitial insert', () => {
    const f = fixture(); const result = f.repo.admit(f.input);
    if (result.kind !== 'inserted') throw new Error('Expected insert');
    for (const update of ["descriptor_json = '{}'", 'revision = 1', "state = 'started'",
      "state = 'cancelled', revision = 2", "child_session_id = 'worker'"])
      expect(() => f.first.exec(`UPDATE goal_reviewer_admissions SET ${update}`)).toThrow();
    expect(() => f.first.exec('DELETE FROM goal_reviewer_admissions')).toThrow(/IMMUTABLE/);
    expect(() => f.first.exec("INSERT INTO goal_reviewer_admissions SELECT 'different',run_id,root_session_id,goal_version,source_fingerprint,'other',descriptor_json,descriptor_sha256,'worker','other-turn','started',1,created_at FROM goal_reviewer_admissions")).toThrow(/INITIAL_STATE/);
    expect(() => f.first.exec("INSERT INTO goal_reviewer_admissions SELECT * FROM goal_reviewer_admissions WHERE true ON CONFLICT(admission_id) DO UPDATE SET state='cancelled',revision=1")).toThrow(/DUPLICATE/);
    expect(f.first.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(f.second.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(f.first.prepare('PRAGMA foreign_key_list(goal_reviewer_admissions)').all()).toEqual([]);
  });

  it('allows ordinary child deletion but tombstone forbids rerun and resurrection', () => {
    const f = fixture(); const result = f.repo.admit(f.input);
    if (result.kind !== 'inserted') throw new Error('Expected insert');
    const id = result.admission.childSessionId;
    const child = f.first.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as Record<string, unknown>;
    f.second.prepare('UPDATE sessions SET title = ? WHERE id = ?').run('Renamed', id);
    expect(f.other.admit(f.input).kind).toBe('existing');
    expect(() => f.second.prepare('UPDATE sessions SET id = ? WHERE id = ?').run('rekeyed', id)).toThrow(/ID_RESERVED/);
    expect(() => f.second.prepare('UPDATE sessions SET id = ? WHERE id = ?').run(id, 'worker')).toThrow(/ID_RESERVED/);
    f.second.prepare('DELETE FROM sessions WHERE id = ?').run(id);
    expect(result.claimStart()).toBe(false);
    expect(f.repo.admit(f.input).kind).toBe('unavailable');
    expect(f.other.admit(f.input).kind).toBe('unavailable');
    expect(f.first.prepare('SELECT count(*) AS n FROM goal_reviewer_admissions').get()).toEqual({ n: 1 });
    const names = Object.keys(child);
    for (const mode of ['INSERT', 'INSERT OR REPLACE']) expect(() => f.first.prepare(
      `${mode} INTO sessions (${names.join(',')}) VALUES (${names.map(() => '?').join(',')})`).run(...Object.values(child)))
      .toThrow(/ID_RESERVED/);
    expect(f.first.prepare('SELECT count(*) AS n FROM sessions').get()).toEqual({ n: 2 });
    // Normal unrelated session mutations/deletion remain available.
    f.first.prepare(`INSERT INTO sessions (${names.join(',')}) VALUES (${names.map(() => '?').join(',')})`)
      .run(...names.map(name => name === 'id' ? 'unrelated' : child[name]));
    f.first.exec("UPDATE sessions SET id = 'renamed-unrelated', title = 'updated' WHERE id = 'unrelated'");
    f.first.exec("DELETE FROM sessions WHERE id = 'renamed-unrelated'");
  });

  it('retains only metadata and hashes, not private goal/worker/prompt/context bodies', () => {
    const f = fixture();
    const privateGoal = 'private human goal sentinel';
    const privateWorker = 'private worker result sentinel';
    f.first.prepare('UPDATE architecture_goal_states SET packet_json = ?').run(JSON.stringify({ content: privateGoal }));
    f.first.prepare("UPDATE messages SET content = ? WHERE id = 'terminal'").run(privateWorker);
    f.first.prepare("UPDATE messages SET content = ? WHERE id = 'prompt'").run('private prompt sentinel');
    f.first.prepare("UPDATE sessions SET runtime_context = ? WHERE id = 'worker'").run(JSON.stringify({
      runtimeKind: 'subagent', architectureContext: { architectureRunId: 'goal-run', privateBody: 'private context sentinel' } }));
    const result = f.repo.admit(f.input);
    if (result.kind !== 'inserted') throw new Error('Expected insert');
    f.first.prepare('DELETE FROM sessions WHERE id = ?').run(result.admission.childSessionId);
    const row = f.first.prepare('SELECT * FROM goal_reviewer_admissions').get();
    for (const body of [privateGoal, privateWorker, 'private prompt sentinel', 'private context sentinel', 'Worker prompt', 'Worker result'])
      expect(JSON.stringify(row)).not.toContain(body);
    expect(result.admission.descriptorJson).toContain('packetSha256');
  });

  it('requires positive integer goal versions in SQL and safe integers in JS', () => {
    const f = fixture(); expect(f.repo.admit(f.input).kind).toBe('inserted');
    const row = f.first.prepare('SELECT * FROM goal_reviewer_admissions').get() as Record<string, unknown>;
    for (const version of [0, -1, 1.5, 'invalid']) {
      const changed = { ...row, admission_id: 'new', child_session_id: 'new-child', planned_turn_id: 'new-turn',
        worker_fingerprint: 'new-worker', goal_version: version };
      const names = Object.keys(changed);
      expect(() => f.first.prepare(`INSERT INTO goal_reviewer_admissions (${names.join(',')}) VALUES (${names.map(() => '?').join(',')})`)
        .run(...Object.values(changed))).toThrow(/CHECK constraint/);
    }
    f.first.exec('UPDATE architecture_goal_states SET source_version = 1.5');
    expect(f.other.admit(f.input).kind).toBe('unavailable');
    f.first.exec('UPDATE architecture_goal_states SET source_version = 9007199254740992');
    expect(f.other.admit(f.input).kind).toBe('unavailable');
  });

  it('stop between admission and start denies start under the existing local fence', () => {
    const f = fixture(); const result = f.repo.admit(f.input);
    if (result.kind !== 'inserted') throw new Error('Expected insert');
    const stop = f.stop.claim('root');
    try { expect(result.claimStart()).toBe(false); } finally { stop.release(); }
    expect(result.claimStart()).toBe(false);
  });

  it('rejects missing/ambiguous terminal proof and unsafe worker revisions', () => {
    const f = fixture();
    expect(f.repo.admit({ ...f.input, worker: { ...f.input.worker, revision: 1.5 } }).kind).toBe('unavailable');
    f.first.exec("UPDATE messages SET role = 'system' WHERE id = 'terminal'");
    expect(f.repo.admit(f.input).kind).toBe('unavailable');
    f.first.exec("UPDATE messages SET role = 'assistant' WHERE id = 'terminal'");
    const run = f.db.select().from(schema.chatRuns).get();
    if (!run) throw new Error('Expected worker run');
    f.db.insert(schema.chatRuns).values({ ...run, id: 'duplicate-run' }).run();
    expect(f.repo.admit(f.input).kind).toBe('unavailable');
    expect(f.first.prepare('SELECT count(*) AS n FROM goal_reviewer_admissions').get()).toEqual({ n: 0 });
  });
});
