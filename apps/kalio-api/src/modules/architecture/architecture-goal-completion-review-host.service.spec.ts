import { afterEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { resolve } from 'node:path';
import type { DrizzleService } from '../../database/drizzle.service';
import * as schema from '../../database/schema';
import { ArchitectureGoalRepository } from './architecture-goal.repository';
import { prepareGoalCompletion } from './architecture-goal-completion';
import { createGoalPacket } from './architecture-goal-source';
import { prepareGoalProjection, goalProjectionPolicyTargets, acceptGoalProjection } from './architecture-goal-projection';
import { ArchitectureGoalCompletionReviewHostService, type GoalCompletionReviewInventoryPort,
  type VerifiedGoalCompletionReviewInventory } from './architecture-goal-completion-review-host.service';

const clients: Database.Database[] = [];
afterEach(() => clients.splice(0).forEach(client => client.close()));
function fixture() {
  const client = new Database(':memory:'); clients.push(client);
  const db = drizzle(client, { schema }); migrate(db, { migrationsFolder: resolve(__dirname, '../../database/migrations') });
  const repo = new ArchitectureGoalRepository({ db } as unknown as DrizzleService);
  const pending = createGoalPacket({ messageId: 'human', sessionId: 'HOST', turnId: 'turn', content: 'Build site.', createdAt: 1 });
  const proposal = prepareGoalProjection(pending, { sourceVersion: 1, criteria: [{ text: 'Build site', sourceQuotes: [{ messageId: 'human', quote: 'Build site.' }], supersedes: [] }] });
  pending.projection = { status: 'pending', base: null, proposal };
  const id = goalProjectionPolicyTargets(pending, proposal)[0]!.id;
  const packet = acceptGoalProjection(pending, proposal, { requiredEvidenceKindsByCriterion: { [id]: ['BUILD_RESULT'] } },
    { sourceVersion: 1, sourceFingerprint: pending.sourceFingerprint, proposalFingerprint: proposal.proposalFingerprint, accepted: true });
  if (packet.projection.status !== 'accepted') throw new Error('fixture');
  repo.create({ runId: 'run', rootSessionId: 'root', packet, createdAt: 1, updatedAt: 1 });
  repo.replaceEvidenceInventory('run', 1, 'root', { schemaVersion: 2, runId: 'run', rootSessionId: 'root', goalVersion: 1, sourceFingerprint: packet.sourceFingerprint,
    host: { evidenceById: { build: { kind: 'BUILD_RESULT', status: 'passed' } }, cliChildrenById: {} },
    provenance: { schemaVersion: 2, runId: 'run', rootSessionId: 'root', goalVersion: 1, sourceFingerprint: packet.sourceFingerprint,
      goalFingerprint: packet.projection.snapshot.goalFingerprint,
      checkpoint: { checkpointId: 'seal', status: 'sealed',
        admissions: [{ callId: 'call', sessionId: 'branch', turnId: 'bt', promptMessageId: 'bp', sequence: 1, admissionCheckpointId: 'admit' }],
        commits: [{ callId: 'call', sequence: 1, commitCheckpointId: 'producer', resultMessageId: 'result', status: 'success' }],
        completedRunJournalRef: { checkpointId: 'journal', eventId: 'done', sequence: 2 } },
      evidenceRefsById: { build: { checkpointId: 'producer', eventId: 'build-event', sequence: 1, evidenceIndex: 0, dispatchCallId: 'call' } },
      childRefsById: {}, supersededEvidenceIds: {},
      buildExpectation: { approvedSource: { messageId: 'human', sessionId: 'HOST', turnId: 'turn' }, executable: 'npm', args: ['run', 'build'], canonicalCwd: 'E:\\project' } } }, 2);
  const verified: VerifiedGoalCompletionReviewInventory = { runId: 'run', rootSessionId: 'root', stateRevision: 2, goalVersion: 1,
    sourceFingerprint: packet.sourceFingerprint, goalFingerprint: packet.projection.snapshot.goalFingerprint, criterionEvidenceIds: { [id]: ['build'] } };
  // Required producer verification is a test fixture, NOT proof of real dispatch provenance.
  const verifyAndBind = vi.fn<GoalCompletionReviewInventoryPort['verifyAndBind']>().mockImplementation(async () => verified);
  const service = new ArchitectureGoalCompletionReviewHostService(repo, { verifyAndBind });
  return { repo, client, service, verified, verifyAndBind, id };
}

describe('repository-backed completion review host (SQLite, fixture verifier)', () => {
  it('assembles an isolated V2 snapshot with distinct source host and internal root', async () => {
    const { service, repo, verified, id } = fixture();
    const result = await service.readCurrent('run');
    expect(result).toMatchObject({ runId: 'run', rootSessionId: 'root', stateRevision: 2, criterionEvidenceIds: { [id]: ['build'] } });
    expect(result.packet.original.sessionId).toBe('HOST');
    const stored = repo.load('run')!.evidenceInventory;
    expect(result.provenance).toEqual(stored?.schemaVersion === 2 ? stored.provenance : null);
    Reflect.set(verified.criterionEvidenceIds, id, []);
    expect(result.criterionEvidenceIds[id]).toEqual(['build']);
    result.packet.original.content = 'changed'; expect(repo.load('run')!.packet.original.content).toBe('Build site.');
  });
  it('retains explicit empty refs instead of deriving matches from evidence kind', async () => {
    const { service, verified, id } = fixture(); Reflect.set(verified.criterionEvidenceIds, id, []);
    expect((await service.readCurrent('run')).criterionEvidenceIds).toEqual({ [id]: [] });
  });
  it('does not fall back to the stored receipt mapping', async () => {
    const { service, repo, verified, id } = fixture(); const state = repo.load('run')!; const inventory = state.evidenceInventory!;
    if (inventory.schemaVersion !== 2) throw new Error('fixture');
    const candidate = prepareGoalCompletion(state.packet, { [id]: ['build'] }, inventory.host,
      { runId: 'run', rootSessionId: 'root', provenance: inventory.provenance });
    repo.authorizeCompletion('run', 2, 'root', { schemaVersion: 2, runId: 'run', rootSessionId: 'root', goalVersion: 1,
      sourceFingerprint: state.packet.sourceFingerprint, reviewedStateRevision: 2, inventoryStateRevision: 2, choice: 'complete', confidence: .95, ...candidate }, 3);
    Reflect.set(verified, 'stateRevision', 3); Reflect.set(verified.criterionEvidenceIds, id, []);
    expect((await service.readCurrent('run')).criterionEvidenceIds).toEqual({ [id]: [] });
    expect(repo.load('run')!.completionAuthorization!.criterionEvidenceIds[id]).toEqual(['build']);
  });
  it('rejects getter-bearing loaded state before accessing packet or invoking verifier', async () => {
    const { service, repo, verifyAndBind } = fixture(); const state = repo.load('run')!; let reads = 0;
    Object.defineProperty(state, 'packet', { enumerable: true, get() { reads++; throw new Error('PRIVATE'); } });
    vi.spyOn(repo, 'load').mockReturnValue(state);
    await expect(service.readCurrent('run')).rejects.toThrow(/^GOAL_REVIEW_HOST_STATE_INVALID$/);
    expect(reads).toBe(0); expect(verifyAndBind).not.toHaveBeenCalled();
  });
  it('loads only the exact run key before and after verification', async () => {
    const { service, repo } = fixture(); const load = vi.spyOn(repo, 'load');
    await service.readCurrent('run'); expect(load.mock.calls).toEqual([['run'], ['run']]);
  });
  it('excludes superseded evidence IDs from criterion references', async () => {
    const { service, repo, verified, id } = fixture(); const state = repo.load('run')!; const inventory = state.evidenceInventory!;
    if (inventory.schemaVersion !== 2) throw new Error('fixture');
    const { inventoryStateRevision: _revision, ...next } = inventory;
    const supplied = structuredClone(next);
    Reflect.set(supplied.provenance.supersededEvidenceIds, 'old', 'build');
    Reflect.set(supplied.provenance.evidenceRefsById, 'old', { ...supplied.provenance.evidenceRefsById.build!, eventId: 'old-event' });
    repo.replaceEvidenceInventory('run', 2, 'root', supplied, 3);
    Reflect.set(verified, 'stateRevision', 3); Reflect.set(verified.criterionEvidenceIds, id, ['old']);
    await expect(service.readCurrent('run')).rejects.toThrow(/^GOAL_REVIEW_HOST_BINDING_INVALID$/);
  });
  it.each(['runId', 'rootSessionId', 'stateRevision', 'goalVersion', 'sourceFingerprint', 'goalFingerprint'])('rejects foreign verifier %s', async key => {
    const { service, verified } = fixture(); Reflect.set(verified, key, key.endsWith('Revision') || key.endsWith('Version') ? 99 : 'foreign');
    await expect(service.readCurrent('run')).rejects.toThrow(/^GOAL_REVIEW_HOST_BINDING_INVALID$/);
  });
  it.each(['missing', 'extra', 'duplicate', 'unknown', 'unknown-field'])('rejects malformed refs %s', async mode => {
    const { service, verified, id } = fixture();
    if (mode === 'missing') Reflect.deleteProperty(verified.criterionEvidenceIds, id);
    if (mode === 'extra') Reflect.set(verified.criterionEvidenceIds, 'foreign', []);
    if (mode === 'duplicate') Reflect.set(verified.criterionEvidenceIds, id, ['build', 'build']);
    if (mode === 'unknown') Reflect.set(verified.criterionEvidenceIds, id, ['unknown']);
    if (mode === 'unknown-field') Reflect.set(verified, 'accepted', true);
    await expect(service.readCurrent('run')).rejects.toThrow(/^GOAL_REVIEW_HOST_BINDING_INVALID$/);
  });
  it('rejects verifier accessors without executing them', async () => {
    const { service, verified } = fixture(); let reads = 0;
    Object.defineProperty(verified, 'goalFingerprint', { enumerable: true, get() { reads++; return 'secret'; } });
    await expect(service.readCurrent('run')).rejects.toThrow(/^GOAL_REVIEW_HOST_BINDING_INVALID$/); expect(reads).toBe(0);
  });
  it('requires a verifier and exposes no driver/source error text', async () => {
    const { service, repo, verifyAndBind } = fixture();
    await expect(new ArchitectureGoalCompletionReviewHostService(repo, {} as GoalCompletionReviewInventoryPort).readCurrent('run')).rejects.toThrow(/^GOAL_REVIEW_HOST_UNAVAILABLE$/);
    verifyAndBind.mockRejectedValue(new Error('PRIVATE SQL SOURCE'));
    await expect(service.readCurrent('run')).rejects.toThrow(/^GOAL_REVIEW_HOST_VERIFICATION_FAILED$/);
  });
  it('rejects V1 storage before calling the verifier', async () => {
    const { service, client, verifyAndBind, repo } = fixture(); const state = repo.load('run')!;
    const legacy = { schemaVersion: 1, runId: 'run', rootSessionId: 'root', goalVersion: 1, sourceFingerprint: state.packet.sourceFingerprint, inventoryStateRevision: 2,
      host: state.evidenceInventory!.host, evidenceRefsById: { build: { checkpointId: 'producer', eventId: 'event', sequence: 1, evidenceIndex: 0 } }, childRefsById: {}, supersededEvidenceIds: {} };
    client.prepare('UPDATE architecture_goal_states SET evidence_inventory_json = ?').run(JSON.stringify(legacy));
    await expect(service.readCurrent('run')).rejects.toThrow(/^GOAL_REVIEW_HOST_STATE_INVALID$/); expect(verifyAndBind).not.toHaveBeenCalled();
  });
  it.each(['CAS', 'same-revision', 'removed'])('rejects state mutation during verifier %s', async mode => {
    const { service, repo, client, verifyAndBind, verified } = fixture();
    verifyAndBind.mockImplementation(async () => {
      const state = repo.load('run')!;
      if (mode === 'CAS') repo.compareAndSwap('run', 2, { rootSessionId: 'root', packet: state.packet, updatedAt: 3 });
      if (mode === 'same-revision') client.exec('UPDATE architecture_goal_states SET updated_at = 3');
      if (mode === 'removed') client.exec("DELETE FROM architecture_goal_states WHERE run_id = 'run'");
      return verified;
    });
    await expect(service.readCurrent('run')).rejects.toThrow(/^GOAL_REVIEW_HOST_STATE_STALE$/);
  });
  it('passes only a clone to verifier, never its authoritative comparison snapshot', async () => {
    const { service, verified, verifyAndBind } = fixture();
    verifyAndBind.mockImplementation(async state => { state.packet.original.content = 'verifier input mutation'; return verified; });
    expect((await service.readCurrent('run')).packet.original.content).toBe('Build site.');
  });
  it.each(['', 'missing'])('rejects absent/invalid run %s without verification', async runId => {
    const { service, verifyAndBind } = fixture();
    await expect(service.readCurrent(runId)).rejects.toThrow(runId ? /^GOAL_REVIEW_HOST_STATE_INVALID$/ : /^GOAL_REVIEW_HOST_INVALID_INPUT$/);
    expect(verifyAndBind).not.toHaveBeenCalled();
  });
  it('propagates abort after verification without returning a snapshot', async () => {
    const { service, verifyAndBind, verified } = fixture(); const controller = new AbortController();
    verifyAndBind.mockImplementation(async () => { controller.abort(); return verified; });
    await expect(service.readCurrent('run', controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });
});
