import { afterEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import type { DrizzleService } from '../../database/drizzle.service';
import * as schema from '../../database/schema';
import { ArchitectureGoalRepository } from './architecture-goal.repository';
import { createGoalPacket, appendGoalSource } from './architecture-goal-source';
import { acceptGoalProjection, goalProjectionPolicyTargets, prepareGoalProjection } from './architecture-goal-projection';
import { prepareGoalCompletion } from './architecture-goal-completion';
import type { GoalEvidenceInventoryV1, GoalEvidenceInventoryV2, GoalCompletionReceiptV2 } from './architecture-goal-completion-state';

function fixture() {
  const client = new Database(':memory:');
  clients.push(client);
  const db = drizzle(client, { schema });
  migrate(db, { migrationsFolder });
  const dependency = { db } as unknown as DrizzleService;
  return { client, dependency, repo: new ArchitectureGoalRepository(dependency) };
}
const packet = () => createGoalPacket({ messageId: 'message', sessionId: 'host', turnId: 'turn',
  content: '  Original human goal\n', createdAt: 10 });
const input = () => ({ runId: 'run', rootSessionId: 'root', packet: packet(), createdAt: 20, updatedAt: 20 });
const emptyCompletion = { evidenceInventory: null, completionAuthorization: null };

function completionFixture() {
  const base = fixture();
  const goal = acceptedPacket();
  base.repo.create({ ...input(), packet: goal });
  if (goal.projection.status !== 'accepted') throw new Error('fixture');
  const inventory: Omit<GoalEvidenceInventoryV2, 'inventoryStateRevision'> = {
    schemaVersion: 2, runId: 'run', rootSessionId: 'root', goalVersion: 1, sourceFingerprint: goal.sourceFingerprint,
    host: { evidenceById: { build: { kind: 'BUILD_RESULT', status: 'passed', data: { exitCode: 0 } } }, cliChildrenById: {} },
    provenance: { schemaVersion: 2, runId: 'run', rootSessionId: 'root', goalVersion: 1,
      sourceFingerprint: goal.sourceFingerprint, goalFingerprint: goal.projection.snapshot.goalFingerprint,
      checkpoint: { checkpointId: 'seal', status: 'sealed',
        admissions: [{ callId: 'call', sessionId: 'branch', turnId: 'bt', promptMessageId: 'bp', sequence: 1, admissionCheckpointId: 'admit' }],
        commits: [{ callId: 'call', sequence: 1, commitCheckpointId: 'checkpoint', resultMessageId: 'result', status: 'success' }],
        completedRunJournalRef: { checkpointId: 'journal', eventId: 'completed', sequence: 2 } },
      evidenceRefsById: { build: { checkpointId: 'checkpoint', eventId: 'event', sequence: 1, evidenceIndex: 0, dispatchCallId: 'call' } },
      childRefsById: {}, supersededEvidenceIds: {},
      buildExpectation: { approvedSource: { messageId: 'message', sessionId: 'host', turnId: 'turn' }, executable: 'npm', args: ['run', 'build'], canonicalCwd: 'E:\\project' } },
  };
  const criterion = goal.projection.status === 'accepted' ? goal.projection.snapshot.criteria[0].id : '';
  const candidate = prepareGoalCompletion(goal, { [criterion]: ['build'] }, inventory.host,
    { runId: 'run', rootSessionId: 'root', provenance: inventory.provenance });
  const receipt = { schemaVersion: 2 as const, runId: 'run', rootSessionId: 'root', goalVersion: 1,
    sourceFingerprint: goal.sourceFingerprint, reviewedStateRevision: 2, inventoryStateRevision: 2,
    choice: 'complete' as const, confidence: .95, ...candidate };
  return { ...base, goal, inventory, receipt };
}

function acceptedPacket() {
  const pending = packet();
  const proposal = prepareGoalProjection(pending, { sourceVersion: 1, criteria: [
    { text: 'Original human goal', sourceQuotes: [{ messageId: 'message', quote: 'Original human goal' }], supersedes: [] },
  ] });
  pending.projection = { status: 'pending', base: null, proposal };
  const policy = { requiredEvidenceKindsByCriterion: Object.fromEntries(
    goalProjectionPolicyTargets(pending, proposal).map(row => [row.id, ['BUILD_RESULT']]),
  ) };
  return acceptGoalProjection(pending, proposal, policy, { sourceVersion: 1,
    sourceFingerprint: pending.sourceFingerprint, proposalFingerprint: proposal.proposalFingerprint, accepted: true });
}

function pendingBasePacket() {
  return appendGoalSource(acceptedPacket(), { ...packet().original, messageId: 'update', turnId: 'next-turn', content: 'New requirement' });
}

function proposalPacket() {
  const pending = packet();
  pending.projection = { status: 'pending', base: null, proposal: prepareGoalProjection(pending, {
    sourceVersion: 1, criteria: [{ text: 'Original human goal', sourceQuotes: [{ messageId: 'message', quote: 'Original human goal' }], supersedes: [] }],
  }) };
  return pending;
}

const clients: Database.Database[] = [];
const migrationsFolder = resolve(__dirname, '../../database/migrations');
afterEach(() => clients.splice(0).forEach(client => client.close()));

describe('architecture goal canonical migration', () => {
  it('creates dedicated storage through the full journal and is idempotent', () => {
    const client = new Database(':memory:');
    clients.push(client);
    const db = drizzle(client);
    migrate(db, { migrationsFolder });
    migrate(db, { migrationsFolder });
    expect(client.prepare("SELECT name FROM sqlite_master WHERE name = 'architecture_goal_states'").get())
      .toEqual({ name: 'architecture_goal_states' });
  });

  it('upgrades a database at the exact current journal prefix without changing legacy data', () => {
    const client = new Database(':memory:');
    clients.push(client);
    const db = drizzle(client);
    const migrations = readMigrationFiles({ migrationsFolder });
    client.exec('CREATE TABLE __drizzle_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, hash text NOT NULL, created_at numeric)');
    for (const migration of migrations.slice(0, -1)) {
      for (const statement of migration.sql) client.exec(statement);
      client.prepare('INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)').run(migration.hash, migration.folderMillis);
    }
    const before = client.prepare('SELECT * FROM execution_profiles ORDER BY id').all();
    client.prepare('INSERT INTO architecture_goal_states (run_id, root_session_id, state_revision, source_version, projection_status, source_fingerprint, goal_fingerprint, packet_json, created_at, updated_at) VALUES (?, ?, 1, 1, ?, ?, NULL, ?, 20, 20)')
      .run('legacy-run', 'root', 'pending', packet().sourceFingerprint, JSON.stringify(packet()));
    migrate(db, { migrationsFolder });
    client.exec(readFileSync(resolve(migrationsFolder, '0035_architecture_goal_states.sql'), 'utf8'));
    migrate(db, { migrationsFolder });
    expect(client.prepare('SELECT * FROM execution_profiles ORDER BY id').all()).toEqual(before);
    expect(client.prepare('SELECT count(*) AS count FROM __drizzle_migrations').get()).toEqual({ count: migrations.length });
    expect(client.prepare('SELECT run_id, evidence_inventory_json, completion_authorization_json FROM architecture_goal_states').get())
      .toEqual({ run_id: 'legacy-run', evidence_inventory_json: null, completion_authorization_json: null });
  });
});

describe('ArchitectureGoalRepository real SQLite', () => {
  it('returns null only for an absent exact run key', () => {
    const { repo } = fixture();
    expect(repo.load('missing')).toBeNull();
    repo.create(input());
    expect(repo.load('run-other')).toBeNull();
  });

  it('survives repository restart and isolates input/output references', () => {
    const { repo, dependency } = fixture();
    const supplied = input();
    const created = repo.create(supplied);
    supplied.packet.original.content = 'caller mutation';
    created.packet.original.content = 'return mutation';
    const restarted = new ArchitectureGoalRepository(dependency);
    const loaded = restarted.load('run');
    expect(loaded).toEqual({ ...input(), stateRevision: 1, ...emptyCompletion });
    if (loaded) loaded.packet.original.content = 'load mutation';
    expect(restarted.load('run')?.packet.original.content).toBe('  Original human goal\n');
  });

  it('does not overwrite create and allows exactly one of two stale CAS writers', () => {
    const { repo, dependency } = fixture();
    repo.create(input());
    expect(() => repo.create(input())).toThrow('GOAL_STATE_CONFLICT');
    const second = new ArchitectureGoalRepository(dependency);
    const next = { rootSessionId: 'root', packet: packet(), updatedAt: 21 };
    repo.compareAndSwap('run', 1, next);
    expect(() => second.compareAndSwap('run', 1, next)).toThrow('GOAL_STATE_CONFLICT');
    expect(repo.load('run')?.stateRevision).toBe(2);
    expect(() => second.compareAndSwap('missing', 1, next)).toThrow('GOAL_STATE_CONFLICT');
  });

  it('keeps packet version stable on policy-only changes while incrementing state revision', () => {
    const { repo } = fixture();
    repo.create(input());
    const next = packet();
    next.completionPolicy = { requiredEvidenceKindsByCriterion: { criterion: ['BUILD_RESULT'] } };
    const saved = repo.compareAndSwap('run', 1, { rootSessionId: 'root', packet: next, updatedAt: 21 });
    expect(saved.stateRevision).toBe(2);
    expect(saved.packet.version).toBe(1);
    expect(saved.createdAt).toBe(20);
    expect(repo.load('run')?.packet.completionPolicy).toEqual(next.completionPolicy);
  });

  it('persists source updates without automatically merging projections', () => {
    const { repo } = fixture();
    repo.create(input());
    const next = appendGoalSource(packet(), { ...packet().original, messageId: 'update', turnId: 'next-turn', content: 'New requirement' });
    const saved = repo.compareAndSwap('run', 1, { rootSessionId: 'root', packet: next, updatedAt: 22 });
    expect(saved.packet.version).toBe(2);
    expect(saved.packet.projection).toEqual({ status: 'pending', base: null });
    expect(repo.load('run')?.packet).toEqual(next);
  });

  it('rejects foreign root ownership on load and CAS without changing the record', () => {
    const { repo } = fixture();
    repo.create(input());
    expect(() => repo.load('run', 'foreign')).toThrow('GOAL_STATE_OWNERSHIP');
    expect(() => repo.compareAndSwap('run', 1, { rootSessionId: 'foreign', packet: packet(), updatedAt: 21 }))
      .toThrow('GOAL_STATE_OWNERSHIP');
    expect(repo.load('run')).toEqual({ ...input(), stateRevision: 1, ...emptyCompletion });
  });

  it('round-trips accepted projection and rejects a mismatched goal fingerprint', () => {
    const { repo, client, dependency } = fixture();
    const accepted = acceptedPacket();
    repo.create({ ...input(), packet: accepted });
    expect(new ArchitectureGoalRepository(dependency).load('run')?.packet).toEqual(accepted);
    client.exec("UPDATE architecture_goal_states SET goal_fingerprint = 'mismatch'");
    expect(() => repo.load('run')).toThrow('GOAL_STATE_CORRUPT');
  });

  it('fails closed without exposing goal text when canonical storage is unavailable', () => {
    const { repo, client } = fixture();
    client.exec('DROP TABLE architecture_goal_states');
    expect(() => repo.create(input())).toThrow('GOAL_STATE_STORAGE_ERROR');
    expect(() => repo.load('run')).toThrow('GOAL_STATE_STORAGE_ERROR');
  });

  it.each([
    ['pending base at current source version', pendingBasePacket, "json_set(packet_json, '$.projection.base.sourceVersion', 2)"],
    ['empty accepted criteria', acceptedPacket, "json_set(packet_json, '$.projection.snapshot.criteria', json('[]'))"],
    ['empty source quotes', acceptedPacket, "json_set(packet_json, '$.projection.snapshot.criteria[0].sourceQuotes', json('[]'))"],
    ['unknown quote reference', acceptedPacket, "json_set(packet_json, '$.projection.snapshot.criteria[0].sourceQuotes[0].messageId', 'foreign')"],
    ['quote absent from source', acceptedPacket, "json_set(packet_json, '$.projection.snapshot.criteria[0].sourceQuotes[0].quote', 'not a source quote')"],
    ['arbitrary host criterion ID', acceptedPacket, "json_set(packet_json, '$.projection.snapshot.criteria[0].id', 'forged-id')"],
    ['unknown supersession', acceptedPacket, "json_set(packet_json, '$.projection.snapshot.criteria[0].supersedes', json('[\"unknown-id\"]'))"],
    ['empty pending base criteria', pendingBasePacket, "json_set(packet_json, '$.projection.base.criteria', json('[]'))"],
    ['base quote after source prefix', pendingBasePacket, "json_set(packet_json, '$.projection.base.criteria[0].sourceQuotes[0].messageId', 'update', '$.projection.base.criteria[0].sourceQuotes[0].quote', 'New requirement')"],
    ['forged base goal fingerprint', pendingBasePacket, "json_set(packet_json, '$.projection.base.goalFingerprint', 'forged-hash')"],
    ['forged proposal fingerprint', proposalPacket, "json_set(packet_json, '$.projection.proposal.proposalFingerprint', 'forged-hash')"],
    ['empty proposal criteria', proposalPacket, "json_set(packet_json, '$.projection.proposal.criteria', json('[]'))"],
    ['unknown proposal quote', proposalPacket, "json_set(packet_json, '$.projection.proposal.criteria[0].sourceQuotes[0].messageId', 'foreign')"],
    ['empty policy evidence kinds', packet, "json_set(packet_json, '$.completionPolicy.requiredEvidenceKindsByCriterion.criterion', json('[]'))"],
    ['missing accepted policy', acceptedPacket, "json_set(packet_json, '$.completionPolicy.requiredEvidenceKindsByCriterion', json('{}'))"],
    ['foreign accepted policy criterion', acceptedPacket, "json_set(packet_json, '$.completionPolicy.requiredEvidenceKindsByCriterion', json('{\"foreign\":[\"BUILD_RESULT\"]}'))"],
  ])('rejects raw database protocol corruption: %s', (_name, makePacket, expression) => {
    const { repo, client } = fixture();
    repo.create({ ...input(), packet: makePacket() });
    client.exec(`UPDATE architecture_goal_states SET packet_json = ${expression}`);
    expect(() => repo.load('run')).toThrow('GOAL_STATE_CORRUPT');
    expect(() => repo.compareAndSwap('run', 1, { rootSessionId: 'root', packet: packet(), updatedAt: 21 }))
      .toThrow('GOAL_STATE_CORRUPT');
  });

  it('rejects a forged accepted goal fingerprint even when the denormalized column agrees', () => {
    const { repo, client } = fixture();
    repo.create({ ...input(), packet: acceptedPacket() });
    client.exec("UPDATE architecture_goal_states SET packet_json = json_set(packet_json, '$.projection.snapshot.goalFingerprint', 'forged-hash'), goal_fingerprint = 'forged-hash'");
    expect(() => repo.load('run')).toThrow('GOAL_STATE_CORRUPT');
  });

  it('validates create and CAS packets before modifying durable state', () => {
    const { repo } = fixture();
    const invalid = acceptedPacket();
    if (invalid.projection.status === 'accepted') invalid.projection.snapshot.goalFingerprint = 'forged-hash';
    expect(() => repo.create({ ...input(), packet: invalid })).toThrow('GOAL_STATE_CORRUPT');
    expect(repo.load('run')).toBeNull();
    repo.create(input());
    expect(() => repo.compareAndSwap('run', 1, { rootSessionId: 'root', packet: invalid, updatedAt: 21 })).toThrow('GOAL_STATE_CORRUPT');
    expect(repo.load('run')).toEqual({ ...input(), stateRevision: 1, ...emptyCompletion });
  });

  it.each([
    ['malformed JSON', "UPDATE architecture_goal_states SET packet_json = '{'"],
    ['schema version', "UPDATE architecture_goal_states SET packet_json = json_set(packet_json, '$.schemaVersion', 2)"],
    ['packet version', "UPDATE architecture_goal_states SET packet_json = json_set(packet_json, '$.version', 2)"],
    ['source version', 'UPDATE architecture_goal_states SET source_version = 2'],
    ['source fingerprint', "UPDATE architecture_goal_states SET source_fingerprint = 'wrong'"],
    ['packet fingerprint', "UPDATE architecture_goal_states SET packet_json = json_set(packet_json, '$.sourceFingerprint', 'wrong')"],
    ['projection status', "UPDATE architecture_goal_states SET packet_json = json_set(packet_json, '$.projection.status', 'accepted')"],
    ['invalid revision', 'UPDATE architecture_goal_states SET state_revision = 0'],
    ['invalid timestamp', 'UPDATE architecture_goal_states SET updated_at = 0'],
  ])('fails closed on corrupt %s, including CAS', (_name, sql) => {
    const { repo, client } = fixture();
    repo.create(input());
    client.exec('PRAGMA ignore_check_constraints = ON');
    client.exec(sql);
    expect(() => repo.load('run')).toThrow('GOAL_STATE_CORRUPT');
    expect(() => repo.compareAndSwap('run', 1, { rootSessionId: 'root', packet: packet(), updatedAt: 21 }))
      .toThrow('GOAL_STATE_CORRUPT');
  });
});

describe('durable completion SQLite CAS', () => {
  it('retains valid V1 reads after restart but refuses new V1 authorization', () => {
    const { repo, client, dependency, inventory, goal, receipt } = completionFixture();
    const legacy: Omit<GoalEvidenceInventoryV1, 'inventoryStateRevision'> = {
      schemaVersion: 1, runId: 'run', rootSessionId: 'root', goalVersion: 1, sourceFingerprint: goal.sourceFingerprint,
      host: inventory.host, evidenceRefsById: { build: { checkpointId: 'checkpoint', eventId: 'event', sequence: 1, evidenceIndex: 0 } }, childRefsById: {}, supersededEvidenceIds: {},
    };
    const candidate = prepareGoalCompletion(goal, receipt.criterionEvidenceIds, legacy.host);
    const legacyReceipt = { ...receipt, schemaVersion: 1 as const, ...candidate };
    repo.replaceEvidenceInventory('run', 1, 'root', legacy, 21);
    expect(() => repo.authorizeCompletion('run', 2, 'root', legacyReceipt as unknown as Omit<GoalCompletionReceiptV2, 'authorizedStateRevision'>, 22)).toThrow('GOAL_STATE_CORRUPT');
    expect(() => repo.authorizeCompletion('run', 2, 'root', receipt, 22)).toThrow('GOAL_STATE_CORRUPT');
    expect(repo.load('run')?.stateRevision).toBe(2);
    client.prepare('UPDATE architecture_goal_states SET state_revision = 3, completion_authorization_json = ? WHERE run_id = ?')
      .run(JSON.stringify({ ...legacyReceipt, authorizedStateRevision: 3 }), 'run');
    expect(new ArchitectureGoalRepository(dependency).load('run')?.completionAuthorization?.schemaVersion).toBe(1);
  });
  it('rejects a V1 receipt against V2 inventory before any durable change', () => {
    const { repo, inventory, receipt } = completionFixture();
    repo.replaceEvidenceInventory('run', 1, 'root', inventory, 21);
    expect(() => repo.authorizeCompletion('run', 2, 'root', { ...receipt, schemaVersion: 1 } as unknown as Omit<GoalCompletionReceiptV2, 'authorizedStateRevision'>, 22)).toThrow('GOAL_STATE_CORRUPT');
    expect(repo.load('run')).toMatchObject({ stateRevision: 2, completionAuthorization: null });
  });
  it.each(['missing', 'open', 'aborted', 'downgrade-inventory', 'downgrade-receipt', 'journal', 'build-command', 'source', 'commit'])('rejects raw V2 corruption %s', mode => {
    const { repo, client, inventory, receipt } = completionFixture();
    repo.replaceEvidenceInventory('run', 1, 'root', inventory, 21); repo.authorizeCompletion('run', 2, 'root', receipt, 22);
    const expressions: Record<string, string> = {
      missing: "evidence_inventory_json = json_remove(evidence_inventory_json, '$.provenance')",
      open: "evidence_inventory_json = json_set(evidence_inventory_json, '$.provenance.checkpoint.status', 'open', '$.provenance.checkpoint.completedRunJournalRef', NULL)",
      aborted: "evidence_inventory_json = json_set(evidence_inventory_json, '$.provenance.checkpoint.status', 'aborted', '$.provenance.checkpoint.completedRunJournalRef', NULL)",
      'downgrade-inventory': "evidence_inventory_json = json_set(evidence_inventory_json, '$.schemaVersion', 1)",
      'downgrade-receipt': "completion_authorization_json = json_set(completion_authorization_json, '$.schemaVersion', 1)",
      journal: "evidence_inventory_json = json_set(evidence_inventory_json, '$.provenance.checkpoint.completedRunJournalRef.eventId', 'changed')",
      'build-command': "evidence_inventory_json = json_set(evidence_inventory_json, '$.provenance.buildExpectation.executable', 'echo')",
      source: "evidence_inventory_json = json_set(evidence_inventory_json, '$.provenance.sourceFingerprint', 'foreign')",
      commit: "evidence_inventory_json = json_set(evidence_inventory_json, '$.provenance.checkpoint.commits', json('[]'))",
    };
    client.exec(`UPDATE architecture_goal_states SET ${expressions[mode]}`);
    expect(() => repo.load('run')).toThrow('GOAL_STATE_CORRUPT');
  });
  it('creates null completion state and round-trips independent inventory/receipt after restart', () => {
    const { repo, dependency, inventory, receipt } = completionFixture();
    expect(repo.load('run')).toMatchObject(emptyCompletion);
    const selected = repo.replaceEvidenceInventory('run', 1, 'root', inventory, 21);
    expect(selected.stateRevision).toBe(2); expect(selected.evidenceInventory?.inventoryStateRevision).toBe(2);
    const authorized = repo.authorizeCompletion('run', 2, 'root', receipt, 22);
    expect(authorized.stateRevision).toBe(3); expect(authorized.completionAuthorization?.authorizedStateRevision).toBe(3);
    inventory.host.evidenceById.build.data = { exitCode: 9 };
    expect(new ArchitectureGoalRepository(dependency).load('run')).toEqual(authorized);
    if (authorized.evidenceInventory) authorized.evidenceInventory.host.evidenceById.build.status = 'failed';
    expect(repo.load('run')?.evidenceInventory?.host.evidenceById.build.status).toBe('passed');
  });
  it.each(['packet', 'policy'])('clears both columns on %s CAS, including policy-only change', (kind) => {
    const { repo, goal, inventory, receipt } = completionFixture();
    repo.replaceEvidenceInventory('run', 1, 'root', inventory, 21); repo.authorizeCompletion('run', 2, 'root', receipt, 22);
    if (kind === 'policy' && goal.projection.status === 'accepted') goal.completionPolicy = {
      requiredEvidenceKindsByCriterion: { [goal.projection.snapshot.criteria[0].id]: ['FINAL_ARTIFACT'] },
    };
    const saved = repo.compareAndSwap('run', 3, { rootSessionId: 'root', packet: goal, updatedAt: 23 });
    expect(saved).toMatchObject({ ...emptyCompletion, stateRevision: 4 }); expect(saved.packet.version).toBe(1);
  });
  it('replacing inventory clears authorization and keeps packet unchanged', () => {
    const { repo, goal, inventory, receipt } = completionFixture();
    repo.replaceEvidenceInventory('run', 1, 'root', inventory, 21); repo.authorizeCompletion('run', 2, 'root', receipt, 22);
    const saved = repo.replaceEvidenceInventory('run', 3, 'root', inventory, 23);
    expect(saved.completionAuthorization).toBeNull(); expect(saved.evidenceInventory?.inventoryStateRevision).toBe(4); expect(saved.packet).toEqual(goal);
  });
  it('allows exactly one stale authorization writer and rejects foreign ownership', () => {
    const { repo, dependency, inventory, receipt } = completionFixture();
    repo.replaceEvidenceInventory('run', 1, 'root', inventory, 21);
    const second = new ArchitectureGoalRepository(dependency);
    repo.authorizeCompletion('run', 2, 'root', receipt, 22);
    expect(() => second.authorizeCompletion('run', 2, 'root', receipt, 22)).toThrow('GOAL_STATE_CONFLICT');
    expect(() => second.replaceEvidenceInventory('run', 3, 'foreign', inventory, 23)).toThrow('GOAL_STATE_OWNERSHIP');
    expect(() => second.authorizeCompletion('missing', 1, 'root', receipt, 23)).toThrow('GOAL_STATE_CONFLICT');
  });
  it('allows exactly one stale inventory replacement writer', () => {
    const { repo, dependency, inventory } = completionFixture(); const second = new ArchitectureGoalRepository(dependency);
    repo.replaceEvidenceInventory('run', 1, 'root', inventory, 21);
    expect(() => second.replaceEvidenceInventory('run', 1, 'root', inventory, 21)).toThrow('GOAL_STATE_CONFLICT');
    expect(repo.load('run')?.stateRevision).toBe(2);
  });
  it('does not rewrite an existing authorization at an extra revision', () => {
    const { repo, inventory, receipt } = completionFixture();
    repo.replaceEvidenceInventory('run', 1, 'root', inventory, 21); repo.authorizeCompletion('run', 2, 'root', receipt, 22);
    expect(() => repo.authorizeCompletion('run', 3, 'root', { ...receipt, reviewedStateRevision: 3 }, 23)).toThrow('GOAL_STATE_CONFLICT');
    expect(repo.load('run')?.stateRevision).toBe(3);
  });
  it('rejects getter-bearing completion input with static errors before spread can omit/coerce it', () => {
    const { repo, inventory, receipt } = completionFixture();
    const malformed = { ...inventory, get privateData(): string { throw new Error('PRIVATE CONTENT'); } };
    expect(() => repo.replaceEvidenceInventory('run', 1, 'root', malformed, 21)).toThrow('GOAL_STATE_CORRUPT');
    expect(repo.load('run')?.stateRevision).toBe(1);
    repo.replaceEvidenceInventory('run', 1, 'root', inventory, 21);
    const malformedReceipt = { ...receipt, get privateData(): string { throw new Error('PRIVATE CONTENT'); } };
    expect(() => repo.authorizeCompletion('run', 2, 'root', malformedReceipt, 22)).toThrow('GOAL_STATE_CORRUPT');
    expect(repo.load('run')?.stateRevision).toBe(2);
  });
  it.each(['inventory', 'receipt'])('validates foreign %s scope before write', (kind) => {
    const { repo, inventory, receipt } = completionFixture();
    if (kind === 'inventory') {
      expect(() => repo.replaceEvidenceInventory('run', 1, 'root', { ...inventory, runId: 'foreign' }, 21)).toThrow('GOAL_STATE_CORRUPT');
      expect(repo.load('run')?.stateRevision).toBe(1);
    } else {
      repo.replaceEvidenceInventory('run', 1, 'root', inventory, 21);
      expect(() => repo.authorizeCompletion('run', 2, 'root', { ...receipt, rootSessionId: 'foreign' }, 22)).toThrow('GOAL_STATE_CORRUPT');
      expect(repo.load('run')?.stateRevision).toBe(2);
    }
  });
  it.each([
    ['JSON', "evidence_inventory_json = '{'"],
    ['orphan', 'evidence_inventory_json = NULL'],
    ['extra revision', 'state_revision = 4'],
    ['index', "evidence_inventory_json = json_set(evidence_inventory_json, '$.provenance.evidenceRefsById.build.evidenceIndex', -1)"],
    ['scope', "evidence_inventory_json = json_set(evidence_inventory_json, '$.goalVersion', 2)"],
    ['binding', "completion_authorization_json = json_set(completion_authorization_json, '$.binding.evidenceFingerprint', 'forged')"],
    ['eligibility', "evidence_inventory_json = json_set(evidence_inventory_json, '$.host.evidenceById.build.status', 'failed')"],
  ])('rejects raw persisted completion corruption: %s', (_name, expression) => {
    const { repo, client, inventory, receipt } = completionFixture();
    repo.replaceEvidenceInventory('run', 1, 'root', inventory, 21); repo.authorizeCompletion('run', 2, 'root', receipt, 22);
    client.exec(`UPDATE architecture_goal_states SET ${expression}`);
    expect(() => repo.load('run')).toThrow('GOAL_STATE_CORRUPT');
  });
});
