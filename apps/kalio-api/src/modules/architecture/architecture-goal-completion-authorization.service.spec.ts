import { afterEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { resolve } from 'node:path';
import type { ArchitectureRun, DecisionSettingsPort } from '@kalio/types';
import type { DrizzleService } from '../../database/drizzle.service';
import * as schema from '../../database/schema';
import { AuditService } from '../chat/audit.service';
import { JevDecisionsClient } from '../../common/jev-decisions.client';
import { createGoalPacket } from './architecture-goal-source';
import { acceptGoalProjection, goalProjectionPolicyTargets, prepareGoalProjection } from './architecture-goal-projection';
import { ArchitectureGoalRepository, type ArchitectureGoalState } from './architecture-goal.repository';
import { ArchitectureGoalCompletionReviewService } from './architecture-goal-completion-review.service';
import { ArchitectureGoalCompletionAuthorizationService, type GoalCompletionAuthorizationHostPort } from './architecture-goal-completion-authorization.service';
import { prepareGoalCompletion } from './architecture-goal-completion';

const run: Pick<ArchitectureRun, 'id' | 'rootSessionId' | 'schemaId'> = { id: 'run', rootSessionId: 'root', schemaId: 'schema' };
const clients: Database.Database[] = [];
afterEach(() => { clients.splice(0).forEach(client => client.close()); vi.unstubAllGlobals(); });
function answer(choice = 'complete', confidence = .95) { return Response.json({ answers: { goal_completion: { type: 'choice', choice, confidence } } }); }
function fixture() {
  const client = new Database(':memory:'); clients.push(client);
  const db = drizzle(client, { schema }); migrate(db, { migrationsFolder: resolve(__dirname, '../../database/migrations') });
  const dependency = { db } as unknown as DrizzleService;
  const repo = new ArchitectureGoalRepository(dependency); const audit = new AuditService(dependency);
  const pending = createGoalPacket({ messageId: 'human', sessionId: 'HOST', turnId: 'turn', content: 'Build home site.', createdAt: 1 });
  const proposal = prepareGoalProjection(pending, { sourceVersion: 1, criteria: [{ text: 'Build home site', sourceQuotes: [{ messageId: 'human', quote: 'Build home site' }], supersedes: [] }] });
  pending.projection = { status: 'pending', base: null, proposal };
  const criterionId = goalProjectionPolicyTargets(pending, proposal)[0].id;
  const packet = acceptGoalProjection(pending, proposal, { requiredEvidenceKindsByCriterion: { [criterionId]: ['BUILD_RESULT'] } },
    { sourceVersion: 1, sourceFingerprint: pending.sourceFingerprint, proposalFingerprint: proposal.proposalFingerprint, accepted: true });
  repo.create({ runId: 'run', rootSessionId: 'root', packet, createdAt: 1, updatedAt: 1 });
  if (packet.projection.status !== 'accepted') throw new Error('fixture');
  repo.replaceEvidenceInventory('run', 1, 'root', { schemaVersion: 2, runId: 'run', rootSessionId: 'root', goalVersion: 1,
    sourceFingerprint: packet.sourceFingerprint, host: { evidenceById: { build: { kind: 'BUILD_RESULT', status: 'passed', data: { exitCode: 0 } } }, cliChildrenById: {} },
    provenance: { schemaVersion: 2, runId: 'run', rootSessionId: 'root', goalVersion: 1, sourceFingerprint: packet.sourceFingerprint,
      goalFingerprint: packet.projection.snapshot.goalFingerprint,
      checkpoint: { checkpointId: 'seal', status: 'sealed',
        admissions: [{ callId: 'call', sessionId: 'branch', turnId: 'bt', promptMessageId: 'bp', sequence: 1, admissionCheckpointId: 'admit' }],
        commits: [{ callId: 'call', sequence: 1, commitCheckpointId: 'producer', resultMessageId: 'result', status: 'success' }],
        completedRunJournalRef: { checkpointId: 'journal', eventId: 'done', sequence: 2 } },
      evidenceRefsById: { build: { checkpointId: 'producer', eventId: 'build-event', sequence: 1, evidenceIndex: 0, dispatchCallId: 'call' } },
      childRefsById: {}, supersededEvidenceIds: {},
      buildExpectation: { approvedSource: { messageId: 'human', sessionId: 'HOST', turnId: 'turn' }, executable: 'npm', args: ['run', 'build'], canonicalCwd: 'E:\\project' } } }, 2);
  const http = vi.fn<typeof fetch>().mockImplementation(async () => answer()); vi.stubGlobal('fetch', http);
  const settings: DecisionSettingsPort = { resolve: vi.fn(async () => ({ endpoint: 'https://decisions.invalid', model: 'jev', apiKey: 'PRIVATE' })), getConfig: vi.fn(), updateConfig: vi.fn() };
  const review = new ArchitectureGoalCompletionReviewService(settings, new JevDecisionsClient(), {
    readCurrent: async () => {
      const state = repo.load('run', 'root'); if (!state?.evidenceInventory) throw new Error('No inventory');
      return { runId: state.runId, rootSessionId: state.rootSessionId, stateRevision: state.stateRevision, packet: state.packet,
        host: state.evidenceInventory.host, criterionEvidenceIds: { [criterionId]: ['build'] },
        ...(state.evidenceInventory.schemaVersion === 2 ? { provenance: state.evidenceInventory.provenance } : {}) };
    },
  });
  // Provenance is a required host-port fixture, NOT live producer proof.
  const verifyDurableInventory = vi.fn(async (_state: ArchitectureGoalState, _signal?: AbortSignal): Promise<void> => undefined);
  const acknowledgeFinalizationRequired = vi.fn(async (_run: typeof run, state: ArchitectureGoalState, _signal?: AbortSignal): Promise<void> => {
    const receipt = state.completionAuthorization; if (!receipt) throw new Error('No authorization');
    await audit.logRequired(`run:goal-completion:${state.stateRevision}`, { sessionId: 'root', type: 'architecture_event', label: 'goal_completion',
      data: { runId: 'run', rootSessionId: 'root', schemaId: 'schema', stateRevision: state.stateRevision, binding: receipt.binding } });
  });
  const host = { verifyDurableInventory, acknowledgeFinalizationRequired };
  return { client, repo, review, host, http, criterionId, service: new ArchitectureGoalCompletionAuthorizationService(repo, review, host) };
}

describe('completion authorization (real SQLite + real Jev parser, mocked HTTP/provenance)', () => {
  it.each(['before', 'verify', 'ACK'])('replay-only sanitizes raw Stop reason during %s', async stage => {
    const { service, repo, host } = fixture();
    await service.authorize(run, 1);
    const controller = new AbortController();
    const raw = new Error('PRIVATE_ABORT_REASON');
    if (stage === 'before') controller.abort(raw);
    else if (stage === 'verify') host.verifyDurableInventory.mockImplementationOnce(async () => { controller.abort(raw); throw raw; });
    else host.acknowledgeFinalizationRequired.mockImplementationOnce(async () => { controller.abort(raw); throw raw; });
    await expect(service.verifyReplay({ run, expectedState: repo.load('run')!, signal: controller.signal }))
      .rejects.toThrow(/^GOAL_AUTH_REPLAY_ABORTED$/);
  });
  it('replay-only refuses absent authorization without semantic review or persistence', async () => {
    const { service, repo, http, host } = fixture();
    const expectedState = repo.load('run')!;
    await expect(service.verifyReplay({ run, expectedState, signal: new AbortController().signal }))
      .rejects.toThrow('GOAL_AUTH_REPLAY_UNAVAILABLE');
    expect(http).not.toHaveBeenCalled();
    expect(host.verifyDurableInventory).not.toHaveBeenCalled();
    expect(repo.load('run')).toEqual(expectedState);
  });
  it('replay-only verifies the exact existing receipt and repeats ACK, never Jev', async () => {
    const { service, repo, http, host } = fixture();
    await service.authorize(run, 1);
    http.mockClear();
    const expectedState = repo.load('run')!;
    expect(await service.verifyReplay({ run, expectedState, signal: new AbortController().signal }))
      .toMatchObject({ status: 'authorized', replayed: true, authorizedStateRevision: expectedState.stateRevision });
    expect(http).not.toHaveBeenCalled();
    expect(host.acknowledgeFinalizationRequired).toHaveBeenCalledTimes(2);
    expect(repo.load('run')).toEqual(expectedState);
  });
  it('replay-only rejects full expected-state mismatch before verifier or review', async () => {
    const { service, repo, http, host } = fixture();
    await service.authorize(run, 1);
    http.mockClear(); host.verifyDurableInventory.mockClear();
    const expectedState = { ...repo.load('run')!, updatedAt: 987654321 };
    await expect(service.verifyReplay({ run, expectedState, signal: new AbortController().signal }))
      .rejects.toThrow('GOAL_AUTH_STATE_STALE');
    expect(host.verifyDurableInventory).not.toHaveBeenCalled(); expect(http).not.toHaveBeenCalled();
  });
  it('replay-only rejects receipt loss during verifier without fresh selection', async () => {
    const { service, repo, client, http, host } = fixture();
    await service.authorize(run, 1);
    http.mockClear();
    const expectedState = repo.load('run')!;
    host.verifyDurableInventory.mockImplementationOnce(async () => {
      client.prepare('UPDATE architecture_goal_states SET completion_authorization_json = NULL').run();
    });
    await expect(service.verifyReplay({ run, expectedState, signal: new AbortController().signal }))
      .rejects.toThrow('GOAL_AUTH_STATE_STALE');
    expect(http).not.toHaveBeenCalled();
  });
  it('replay-only forwards Stop to verifier and never ACKs after abortion', async () => {
    const { service, repo, http, host } = fixture();
    await service.authorize(run, 1);
    http.mockClear(); host.acknowledgeFinalizationRequired.mockClear();
    const controller = new AbortController();
    host.verifyDurableInventory.mockImplementationOnce(async (_state, signal) => {
      expect(signal).toBe(controller.signal); controller.abort();
    });
    await expect(service.verifyReplay({ run, expectedState: repo.load('run')!, signal: controller.signal })).rejects.toThrow();
    expect(host.acknowledgeFinalizationRequired).not.toHaveBeenCalled(); expect(http).not.toHaveBeenCalled();
  });
  it('replay-only rejects expected-state accessors without invoking them', async () => {
    const { service, repo, http, host } = fixture();
    let reads = 0;
    const expectedState = { ...repo.load('run')! };
    Object.defineProperty(expectedState, 'packet', { enumerable: true, get: () => { reads++; throw new Error('private'); } });
    await expect(service.verifyReplay({ run, expectedState, signal: new AbortController().signal }))
      .rejects.toThrow('GOAL_AUTH_INVALID_INPUT');
    expect(reads).toBe(0); expect(host.verifyDurableInventory).not.toHaveBeenCalled(); expect(http).not.toHaveBeenCalled();
  });
  it.each([false, true])('rejects legacy inventory before review or replay (receipt=%s)', async replay => {
    const { service, repo, client, host, http, criterionId } = fixture();
    const state = repo.load('run')!; const inventory = state.evidenceInventory!;
    const legacy = { schemaVersion: 1, runId: 'run', rootSessionId: 'root', goalVersion: 1, sourceFingerprint: state.packet.sourceFingerprint,
      inventoryStateRevision: 2, host: inventory.host,
      evidenceRefsById: { build: { checkpointId: 'producer', eventId: 'build-event', sequence: 1, evidenceIndex: 0 } }, childRefsById: {}, supersededEvidenceIds: {} };
    const candidate = prepareGoalCompletion(state.packet, { [criterionId]: ['build'] }, inventory.host);
    const receipt = { schemaVersion: 1, runId: 'run', rootSessionId: 'root', goalVersion: 1, sourceFingerprint: state.packet.sourceFingerprint,
      reviewedStateRevision: 2, authorizedStateRevision: 3, inventoryStateRevision: 2, choice: 'complete', confidence: .95, ...candidate };
    client.prepare('UPDATE architecture_goal_states SET state_revision = ?, evidence_inventory_json = ?, completion_authorization_json = ?').run(replay ? 3 : 2, JSON.stringify(legacy), replay ? JSON.stringify(receipt) : null);
    expect(repo.load('run')?.evidenceInventory?.schemaVersion).toBe(1);
    await expect(service.authorize(run, 1)).rejects.toThrow(/^GOAL_AUTH_PROVENANCE_FAILED$/);
    expect(http).not.toHaveBeenCalled(); expect(host.verifyDurableInventory).not.toHaveBeenCalled(); expect(host.acknowledgeFinalizationRequired).not.toHaveBeenCalled();
    expect(repo.load('run')?.stateRevision).toBe(replay ? 3 : 2);
  });
  it('rejects receipt downgrade before any verifier/review/ACK', async () => {
    const { service, repo, client, host, http } = fixture();
    // A tagged legacy receipt cannot be paired with a V2 inventory even if its fields are otherwise valid.
    const state = repo.load('run')!;
    const inventory = state.evidenceInventory!;
    if (inventory.schemaVersion !== 2) throw new Error('fixture');
    const criterion = state.packet.projection.status === 'accepted' ? state.packet.projection.snapshot.criteria[0]!.id : '';
    const candidate = prepareGoalCompletion(state.packet, { [criterion]: ['build'] }, inventory.host, { runId: 'run', rootSessionId: 'root', provenance: inventory.provenance });
    const receipt = { schemaVersion: 1, runId: 'run', rootSessionId: 'root', goalVersion: 1, sourceFingerprint: state.packet.sourceFingerprint,
      reviewedStateRevision: 2, authorizedStateRevision: 3, inventoryStateRevision: 2, choice: 'complete', confidence: .95, ...candidate };
    client.prepare('UPDATE architecture_goal_states SET state_revision = 3, completion_authorization_json = ?').run(JSON.stringify(receipt));
    await expect(service.authorize(run, 1)).rejects.toThrow(/^GOAL_AUTH_STATE_INVALID$/);
    expect(http).not.toHaveBeenCalled(); expect(host.verifyDurableInventory).not.toHaveBeenCalled(); expect(host.acknowledgeFinalizationRequired).not.toHaveBeenCalled();
  });
  it('persists only real reviewed complete, awaits required durable ACK, and returns no raw receipt', async () => {
    const { service, repo, http, client } = fixture();
    const result = await service.authorize(run, 1);
    expect(result).toMatchObject({ status: 'authorized', authorizedStateRevision: 3, checkpointId: 'run:goal-completion:3', replayed: false });
    expect(result).not.toHaveProperty('receipt'); expect(JSON.stringify(result)).not.toContain('Build home site');
    expect(http).toHaveBeenCalledOnce(); expect(repo.load('run')?.completionAuthorization?.choice).toBe('complete');
    expect(client.prepare("SELECT count(*) AS n FROM audit_log WHERE id = 'run:goal-completion:3'").get()).toEqual({ n: 1 });
  });
  it('replays existing authorization and ACK without another Jev call or revision rewrite', async () => {
    const { service, repo, http, host, client } = fixture();
    await service.authorize(run, 1);
    expect(await service.authorize(run, 1)).toMatchObject({ status: 'authorized', replayed: true, authorizedStateRevision: 3 });
    expect(http).toHaveBeenCalledOnce(); expect(repo.load('run')?.stateRevision).toBe(3);
    expect(host.acknowledgeFinalizationRequired).toHaveBeenCalledTimes(2);
    expect(client.prepare("SELECT count(*) AS n FROM audit_log WHERE id = 'run:goal-completion:3'").get()).toEqual({ n: 1 });
  });
  it.each(['continue', 'needs_user'])('does not persist completion for %s', async (status) => {
    const { service, repo, http, host, criterionId } = fixture();
    http.mockImplementation(async () => answer(status === 'continue' ? `continue:${criterionId}` : 'complete', status === 'continue' ? .95 : .8));
    expect(await service.authorize(run, 1)).toHaveProperty('status', status);
    expect(repo.load('run')?.stateRevision).toBe(2); expect(repo.load('run')?.completionAuthorization).toBeNull();
    expect(host.acknowledgeFinalizationRequired).not.toHaveBeenCalled();
  });
  it('fails closed before review when provenance verification refuses', async () => {
    const { service, repo, http, host } = fixture(); host.verifyDurableInventory.mockRejectedValue(new Error('PRIVATE producer data'));
    await expect(service.authorize(run, 1)).rejects.toThrow(/^GOAL_AUTH_PROVENANCE_FAILED$/);
    expect(http).not.toHaveBeenCalled(); expect(repo.load('run')?.completionAuthorization).toBeNull();
  });
  it.each(['first-verification', 'post-review-verification', 'ACK'])('rejects state change during %s without authorized return', async (stage) => {
    const { service, repo, host, http } = fixture(); let verified = 0;
    const mutate = () => { const state = repo.load('run')!; repo.compareAndSwap('run', state.stateRevision, { rootSessionId: 'root', packet: state.packet, updatedAt: state.updatedAt + 1 }); };
    host.verifyDurableInventory.mockImplementation(async () => { verified++; if (stage === 'first-verification' || (stage === 'post-review-verification' && verified === 2)) mutate(); });
    if (stage === 'ACK') host.acknowledgeFinalizationRequired.mockImplementation(async () => mutate());
    await expect(service.authorize(run, 1)).rejects.toThrow(/^GOAL_AUTH_STATE_STALE$/);
    expect(repo.load('run')?.completionAuthorization).toBeNull(); if (stage === 'first-verification') expect(http).not.toHaveBeenCalled();
  });
  it('keeps authorization after ACK failure, exposes no receipt, and retries without Jev', async () => {
    const { service, repo, host, http } = fixture(); const write = host.acknowledgeFinalizationRequired.getMockImplementation()!;
    host.acknowledgeFinalizationRequired.mockRejectedValueOnce(new Error('PRIVATE driver params'));
    await expect(service.authorize(run, 1)).rejects.toThrow(/^GOAL_AUTH_ACK_FAILED$/);
    expect(repo.load('run')?.stateRevision).toBe(3);
    host.acknowledgeFinalizationRequired.mockImplementation(write);
    expect(await service.authorize(run, 1)).toMatchObject({ status: 'authorized', replayed: true }); expect(http).toHaveBeenCalledOnce();
  });
  it('does not return authorized when aborted after successful ACK', async () => {
    const { service, host, repo } = fixture(); const controller = new AbortController(); const ack = host.acknowledgeFinalizationRequired.getMockImplementation()!;
    host.acknowledgeFinalizationRequired.mockImplementation(async (...args) => { await ack(...args); controller.abort(); });
    await expect(service.authorize(run, 1, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(repo.load('run')?.completionAuthorization).not.toBeNull();
  });
  it('waits for ACK rather than returning the persisted authorization early', async () => {
    const { service, host, repo } = fixture();
    let release: () => void = () => { throw new Error('ACK not waiting'); };
    let entered: () => void = () => { throw new Error('ACK not entered'); };
    const gate = new Promise<void>(resolve => { release = resolve; });
    const entry = new Promise<void>(resolve => { entered = resolve; });
    host.acknowledgeFinalizationRequired.mockImplementation(async () => { entered(); await gate; });
    let returned = false;
    const pending = service.authorize(run, 1).then(result => { returned = true; return result; });
    await entry;
    expect(repo.load('run')?.completionAuthorization).not.toBeNull(); expect(returned).toBe(false);
    release(); expect(await pending).toHaveProperty('status', 'authorized');
  });
  it.each([
    ['root', "root_session_id = 'foreign'"],
    ['source', "source_fingerprint = 'foreign'"],
    ['binding', "completion_authorization_json = json_set(completion_authorization_json, '$.binding.evidenceFingerprint', 'foreign')"],
    ['valid receipt mutation', "completion_authorization_json = json_set(completion_authorization_json, '$.confidence', 1)"],
  ])('rejects same-revision %s mutation during ACK', async (_name, expression) => {
    const { service, host, client, repo } = fixture();
    host.acknowledgeFinalizationRequired.mockImplementation(async () => { client.exec(`UPDATE architecture_goal_states SET ${expression}`); });
    await expect(service.authorize(run, 1)).rejects.toThrow(/^GOAL_AUTH_STATE_STALE$/);
    expect(client.prepare('SELECT state_revision FROM architecture_goal_states').get()).toEqual({ state_revision: 3 });
    if (_name === 'valid receipt mutation') expect(repo.load('run')?.completionAuthorization?.confidence).toBe(1);
  });
  it('replay cannot bypass a verifier that now rejects provenance', async () => {
    const { service, host, http } = fixture(); await service.authorize(run, 1);
    host.verifyDurableInventory.mockRejectedValue(new Error('PRIVATE provenance'));
    await expect(service.authorize(run, 1)).rejects.toThrow(/^GOAL_AUTH_PROVENANCE_FAILED$/);
    expect(http).toHaveBeenCalledOnce(); expect(host.acknowledgeFinalizationRequired).toHaveBeenCalledOnce();
  });
  it('rejects absent canonical inventory without review', async () => {
    const { service, repo, http } = fixture(); const state = repo.load('run')!;
    repo.compareAndSwap('run', state.stateRevision, { rootSessionId: 'root', packet: state.packet, updatedAt: 3 });
    await expect(service.authorize(run, 1)).rejects.toThrow(/^GOAL_AUTH_PROVENANCE_FAILED$/); expect(http).not.toHaveBeenCalled();
  });
  it('requires exact selection revision and does not accept a synthetic boolean as proof', async () => {
    const { service, review, repo } = fixture();
    const selection = await review.select('run', 'root', 1);
    if (selection.status !== 'complete') throw new Error('Expected complete fixture');
    vi.spyOn(review, 'select').mockResolvedValue({ ...selection, reviewedStateRevision: 1 });
    await expect(service.authorize(run, 1)).rejects.toThrow(/^GOAL_AUTH_SELECTION_INVALID$/);
    expect(repo.load('run')?.completionAuthorization).toBeNull();
    vi.mocked(review.select).mockResolvedValue({ ...selection, binding: { ...selection.binding, evidenceFingerprint: 'forged' } });
    await expect(service.authorize(run, 1)).rejects.toThrow(/^GOAL_AUTH_SELECTION_INVALID$/);
    expect(repo.load('run')?.completionAuthorization).toBeNull();
  });
  it('refuses a complete selection bound through the legacy helper path', async () => {
    const { service, review, repo, host } = fixture();
    const selected = await review.select('run', 'root', 1);
    if (selected.status !== 'complete') throw new Error('fixture');
    const state = repo.load('run')!;
    const legacy = prepareGoalCompletion(state.packet, selected.candidate.criterionEvidenceIds, state.evidenceInventory!.host);
    vi.spyOn(review, 'select').mockResolvedValue({ ...selected, binding: legacy.binding, candidate: legacy, callerBinding: { ...legacy.binding, accepted: true } });
    await expect(service.authorize(run, 1)).rejects.toThrow(/^GOAL_AUTH_SELECTION_INVALID$/);
    expect(repo.load('run')).toMatchObject({ stateRevision: 2, completionAuthorization: null });
    expect(host.acknowledgeFinalizationRequired).not.toHaveBeenCalled();
  });
  it('rejects provenance mutation during ACK even when revision is unchanged', async () => {
    const { service, host, client } = fixture();
    host.acknowledgeFinalizationRequired.mockImplementation(async () => {
      client.exec("UPDATE architecture_goal_states SET evidence_inventory_json = json_set(evidence_inventory_json, '$.provenance.checkpoint.completedRunJournalRef.eventId', 'other')");
    });
    await expect(service.authorize(run, 1)).rejects.toThrow(/^GOAL_AUTH_STATE_STALE$/);
    expect(client.prepare('SELECT state_revision FROM architecture_goal_states').get()).toEqual({ state_revision: 3 });
  });
  it('requires both host methods and never silently bypasses a missing verifier', async () => {
    const { repo, review, http } = fixture();
    const service = new ArchitectureGoalCompletionAuthorizationService(repo, review, {} as GoalCompletionAuthorizationHostPort);
    await expect(service.authorize(run, 1)).rejects.toThrow(/^GOAL_AUTH_HOST_UNAVAILABLE$/); expect(http).not.toHaveBeenCalled();
  });
  it.each(['root', 'version'])('rejects foreign %s without review', async (part) => {
    const { service, http } = fixture();
    await expect(service.authorize(part === 'root' ? { ...run, rootSessionId: 'foreign' } : run, part === 'version' ? 2 : 1)).rejects.toThrow(/^GOAL_AUTH_STATE_INVALID$/);
    expect(http).not.toHaveBeenCalled();
  });
});
