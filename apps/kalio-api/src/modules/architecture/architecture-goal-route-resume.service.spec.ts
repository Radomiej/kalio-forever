import { afterEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { resolve } from 'node:path';
import type { ArchitectureExecutionEvent, ArchitectureRun, ArchitectureSchema } from '@kalio/types';
import type { DrizzleService } from '../../database/drizzle.service';
import * as databaseSchema from '../../database/schema';
import { AuditService } from '../chat/audit.service';
import { ArchitectureGoalRepository, type ArchitectureGoalState } from './architecture-goal.repository';
import { createGoalPacket, appendGoalSource } from './architecture-goal-source';
import { acceptGoalProjection, goalProjectionPolicyTargets, prepareGoalProjection } from './architecture-goal-projection';
import { inspectGoalCompletion } from './architecture-goal-completion';
import type { GoalEvidenceInventoryInput } from './architecture-goal-completion-state';
import { goalPhaseBinding } from './architecture-graph-goal-nodes';
import { ArchitectureGoalRouteResumeService, type GoalRouteResumeHostPort, type GoalRouteCompletionReplayPort } from './architecture-goal-route-resume.service';
import type { GoalCompletionReviewHostPort } from './architecture-goal-completion-review.service';
import type { ArchitectureGoalCompletionReviewService } from './architecture-goal-completion-review.service';
import { ArchitectureGoalCompletionAuthorizationService } from './architecture-goal-completion-authorization.service';

const databases: Database.Database[] = [];
afterEach(() => databases.splice(0).forEach(db => db.close()));
type Phase = 'proposal' | 'projection' | 'work' | 'continue' | 'artifact';
function fixture(phase: Phase = 'projection') {
  const database = new Database(':memory:'); databases.push(database);
  const db = drizzle(database, { schema: databaseSchema }); migrate(db, { migrationsFolder: resolve(__dirname, '../../database/migrations') });
  const dependency = { db } as unknown as DrizzleService;
  const repository = new ArchitectureGoalRepository(dependency); const audit = new AuditService(dependency);
  const packet = createGoalPacket({ messageId: 'human', sessionId: 'HOST', turnId: 'turn', content: 'Build feature', createdAt: 1 });
  const proposal = prepareGoalProjection(packet, { sourceVersion: 1, criteria: [{ text: 'Build feature', sourceQuotes: [{ messageId: 'human', quote: 'Build feature' }], supersedes: [] }] });
  packet.projection = { status: 'pending', base: null, proposal };
  const criterionId = goalProjectionPolicyTargets(packet, proposal)[0]!.id;
  const accepted = acceptGoalProjection(packet, proposal, { requiredEvidenceKindsByCriterion: { [criterionId]: ['BUILD_RESULT'] } },
    { sourceVersion: 1, sourceFingerprint: packet.sourceFingerprint, proposalFingerprint: proposal.proposalFingerprint, accepted: true });
  repository.create({ runId: 'run', rootSessionId: 'root', packet: phase === 'proposal' ? packet : accepted, createdAt: 1, updatedAt: 1 });
  if (phase === 'work' || phase === 'continue' || phase === 'artifact') {
    if (accepted.projection.status !== 'accepted') throw new Error('fixture');
    const inventory: GoalEvidenceInventoryInput = { schemaVersion: 2, runId: 'run', rootSessionId: 'root', goalVersion: 1, sourceFingerprint: accepted.sourceFingerprint,
      host: { evidenceById: { build: { kind: 'BUILD_RESULT', status: 'passed', data: { exitCode: 0 } } }, cliChildrenById: {} },
      provenance: { schemaVersion: 2, runId: 'run', rootSessionId: 'root', goalVersion: 1, sourceFingerprint: accepted.sourceFingerprint, goalFingerprint: accepted.projection.snapshot.goalFingerprint,
        checkpoint: { checkpointId: 'seal', status: 'sealed', admissions: [{ callId: 'call', sessionId: 'branch', turnId: 'bt', promptMessageId: 'bp', sequence: 1, admissionCheckpointId: 'admit' }],
          commits: [{ callId: 'call', sequence: 1, commitCheckpointId: 'commit', resultMessageId: 'result', status: 'success' }], completedRunJournalRef: { checkpointId: 'journal', eventId: 'done', sequence: 2 } },
        evidenceRefsById: { build: { checkpointId: 'commit', eventId: 'build', sequence: 1, evidenceIndex: 0, dispatchCallId: 'call' } }, childRefsById: {}, supersededEvidenceIds: {},
        buildExpectation: { approvedSource: { messageId: 'human', sessionId: 'HOST', turnId: 'turn' }, executable: 'npm', args: ['run', 'build'], canonicalCwd: 'E:\\fixture' } } };
    repository.replaceEvidenceInventory('run', 1, 'root', inventory, 2);
  }
  const load = (): ArchitectureGoalState => { const state = repository.load('run', 'root'); if (!state) throw new Error('fixture'); return state; };
  const snapshot = () => {
    const state = load(); const inventory = state.evidenceInventory;
    if (inventory?.schemaVersion !== 2) throw new Error('fixture');
    return { runId: 'run', rootSessionId: 'root', stateRevision: state.stateRevision, packet: state.packet,
      host: inventory.host, provenance: inventory.provenance, criterionEvidenceIds: { [criterionId]: ['build'] } };
  };
  const binding = () => { const s = snapshot(); return inspectGoalCompletion(s.packet, s.criterionEvidenceIds, s.host,
    { runId: s.runId, rootSessionId: s.rootSessionId, provenance: s.provenance }).binding; };
  if (phase === 'artifact') {
    const state = load(); const inventory = state.evidenceInventory; if (inventory?.schemaVersion !== 2) throw new Error('fixture');
    // Storage fixture, not a claim of real Jev acceptance or producer trust.
    repository.authorizeCompletion('run', state.stateRevision, 'root', { schemaVersion: 2, runId: 'run', rootSessionId: 'root', goalVersion: 1,
      sourceFingerprint: state.packet.sourceFingerprint, reviewedStateRevision: state.stateRevision, inventoryStateRevision: inventory.inventoryStateRevision,
      choice: 'complete', confidence: .95, binding: binding(), criterionEvidenceIds: { [criterionId]: ['build'] } }, 3);
  }
  const topology = { workerNodeId: 'worker', judgeNodeId: 'judge', completionNodeIds: ['end'] };
  const schema: ArchitectureSchema = { id: 'schema', name: 'Fixture', description: 'Fixture', version: '1',
    roleSlots: ['worker', 'judge'].map(id => ({ id, label: id, description: id, slotType: 'participant', defaultPersonaId: id, allowedPersonaTags: [], required: true, canOverrideAtRunStart: false })),
    nodes: [{ id: 'worker', label: 'Worker', kind: 'role', roleSlotId: 'worker' }, { id: 'judge', label: 'Judge', kind: 'role', roleSlotId: 'judge' }, { id: 'end', label: 'End', kind: 'artifact' }],
    edges: [{ id: 'wj', fromNodeId: 'worker', toNodeId: 'judge' }, { id: 'jw', fromNodeId: 'judge', toNodeId: 'worker', selection: 'continuation' }, { id: 'je', fromNodeId: 'judge', toNodeId: 'end' }],
    routerPolicy: { mode: 'evidence_first', mustAddressCriticFindings: true, canReturnNeedsMoreResearch: true }, contextPolicy: { includeUserTask: true, includeProjectMemory: false, includeBrowserSession: false, includePriorDecisions: false },
    memoryPolicy: { persistFinalArtifact: true, persistRouterDecision: true }, outputArtifactSchema: 'goal' };
  const run: ArchitectureRun = { id: 'run', rootSessionId: 'root', schemaId: 'schema', prompt: 'Build feature', goalPacket: load().packet, context: { goalProtocol: 1 },
    executionMode: 'subagent_execution', branchSessionIds: { worker: 'branch', judge: 'judge-branch' }, status: 'running', createdAt: 1, updatedAt: 1 };
  const from = phase === 'proposal' || phase === 'work' ? 'worker' : 'judge'; const to = from === 'worker' ? 'judge' : phase === 'artifact' ? 'end' : 'worker';
  const event: ArchitectureExecutionEvent = { id: 'anchor', runId: 'run', sequence: 2, type: 'router_decision', nodeId: from, createdAt: 2, message: 'Host branch',
    route: { source: 'runtime_fallback', fromNodeId: from, nextNodeId: to, selectedNodeIds: [to], rejectedNodeIds: [] },
    data: { runId: 'run', rootSessionId: 'root', schemaId: 'schema', pendingNodeIds: [to], visitCounts: { [from]: 1 }, goalBinding: goalPhaseBinding(load()),
      ...(phase === 'continue' || phase === 'artifact' ? { completionBinding: binding() } : {}), ...(phase === 'continue' ? { criterionId } : {}) } };
  let segment = { admissionCheckpointId: 'admission', topology, events: [event] };
  const read = vi.fn<GoalRouteResumeHostPort['readAdmittedSegment']>(async () => structuredClone(segment));
  const verify = vi.fn<GoalRouteResumeHostPort['verifyRequiredAnchorAndCurrentVisit']>(async () => ({ checkpointId: 'route-ack' }));
  const host: GoalRouteResumeHostPort = { readAdmittedSegment: read, verifyRequiredAnchorAndCurrentVisit: verify };
  const completionHost: GoalCompletionReviewHostPort = { readCurrent: vi.fn(async () => snapshot()) };
  const replay = vi.fn<GoalRouteCompletionReplayPort['verifyReplay']>(async input => {
    const state = load(); if (JSON.stringify(state) !== JSON.stringify(input.expectedState) || state.completionAuthorization?.schemaVersion !== 2) throw new Error('fixture');
    return { status: 'authorized', replayed: true, authorizedStateRevision: state.stateRevision, checkpointId: `run:goal-completion:${state.stateRevision}`, binding: state.completionAuthorization.binding };
  });
  const service = new ArchitectureGoalRouteResumeService(repository, host, completionHost, { verifyReplay: replay });
  const controller = new AbortController(); const input = { run, schema, events: [event], signal: controller.signal };
  return { service, input, run, event, load, repository, host, read, verify, completionHost, replay, controller, criterionId, snapshot, audit,
    segment: () => segment, setSegment: (value: typeof segment) => { segment = value; } };
}

describe('trusted goal route resume boundary (fixture authorities, not production registration)', () => {
  it.each(['proposal', 'projection', 'work', 'continue', 'artifact'] as const)('validates scoped %s recovery and returns only its cursor', async phase => {
    const f = fixture(phase); const cursor = await f.service.resolve(f.input);
    expect(cursor).toMatchObject({ reason: 'runtime_recovery', pendingNodeIds: [phase === 'artifact' ? 'end' : phase === 'proposal' || phase === 'work' ? 'judge' : 'worker'] });
    expect(f.verify).toHaveBeenCalled(); expect(f.replay).toHaveBeenCalledTimes(phase === 'artifact' ? 1 : 0);
    expect(cursor).not.toHaveProperty('accepted');
  });
  it('does not accept a merged event as durable anchor authority', async () => {
    const f = fixture(); f.setSegment({ ...f.segment(), events: [] });
    await expect(f.service.resolve(f.input)).rejects.toThrow(/^GOAL_ROUTE_RESUME_FAILED$/); expect(f.verify).not.toHaveBeenCalled();
  });
  it.each(['records', 'ack', 'readmission', 'truncated', 'visit'])('required host rejection for %s fails closed without raw leaks', async stage => {
    const f = fixture();
    if (stage === 'records' || stage === 'truncated') f.read.mockRejectedValue(new Error('PRIVATE'));
    else f.verify.mockRejectedValue(new Error('PRIVATE'));
    await expect(f.service.resolve(f.input)).rejects.toThrow(/^GOAL_ROUTE_RESUME_FAILED$/);
  });
  it('requires a concrete host producer, never defaults to a successful verifier', async () => {
    const f = fixture(); Reflect.set(f.host, 'verifyRequiredAnchorAndCurrentVisit', undefined);
    await expect(f.service.resolve(f.input)).rejects.toThrow(/^GOAL_ROUTE_RESUME_FAILED$/);
  });
  it.each(['run', 'root', 'schema', 'branch', 'binding', 'admission'])('rejects foreign/missing %s identity', async kind => {
    const f = fixture();
    if (kind === 'run') f.run.id = 'foreign'; if (kind === 'root') f.run.rootSessionId = 'foreign';
    if (kind === 'schema') f.run.schemaId = 'foreign'; if (kind === 'branch') f.run.branchSessionIds = {};
    if (kind === 'binding') Reflect.set(f.event.data!.goalBinding as object, 'stateRevision', 99);
    if (kind === 'admission') f.segment().admissionCheckpointId = '';
    await expect(f.service.resolve(f.input)).rejects.toThrow(/^GOAL_ROUTE_RESUME_FAILED$/);
  });
  it('rejects an old ACKed route after canonical source update admission', async () => {
    const f = fixture(); const state = f.load(); const packet = appendGoalSource(state.packet, { messageId: 'new', sessionId: 'HOST', turnId: 'update', content: 'More work', createdAt: 3 });
    f.repository.compareAndSwap('run', state.stateRevision, { rootSessionId: 'root', packet, updatedAt: 3 }); f.run.goalPacket = packet;
    await expect(f.service.resolve(f.input)).rejects.toThrow(/^GOAL_ROUTE_RESUME_FAILED$/); expect(f.verify).not.toHaveBeenCalled();
  });
  it.each(['pause', 'stop', 'final'])('cannot turn %s history into execution', async kind => {
    const f = fixture();
    if (kind === 'pause') { delete f.event.route; delete f.event.nodeId; f.event.reasonCode = 'runtime_pause'; }
    else f.segment().events.push({ id: 'terminal', runId: 'run', sequence: 3, type: kind === 'stop' ? 'run_stopped' : 'final_artifact', message: '', createdAt: 3 });
    await expect(f.service.resolve(f.input)).rejects.toThrow(/^GOAL_ROUTE_RESUME_FAILED$/); expect(f.verify).not.toHaveBeenCalled();
  });
  it('explicit readmitted segment can proceed only after required host verification', async () => {
    const f = fixture(); f.input.events.unshift({ id: 'old-stop', runId: 'run', sequence: 1, type: 'run_stopped', message: '', createdAt: 1 });
    f.setSegment({ ...f.segment(), admissionCheckpointId: 'readmitted-after-stop', events: [f.event] });
    await expect(f.service.resolve(f.input)).resolves.toMatchObject({ pendingNodeIds: ['worker'] });
    expect(f.verify.mock.calls[0]![0].admissionCheckpointId).toBe('readmitted-after-stop');
  });
  it.each(['segment', 'anchor', 'inventory', 'replay'])('detects full repository drift across %s await', async stage => {
    const f = fixture(stage === 'replay' ? 'artifact' : stage === 'inventory' ? 'continue' : 'projection');
    const mutate = () => { const state = f.load(); f.repository.compareAndSwap('run', state.stateRevision, { rootSessionId: 'root', packet: state.packet, updatedAt: state.updatedAt + 1 }); };
    if (stage === 'segment') f.read.mockImplementation(async () => { const result = structuredClone(f.segment()); mutate(); return result; });
    if (stage === 'anchor') f.verify.mockImplementation(async () => { mutate(); return { checkpointId: 'ack' }; });
    if (stage === 'inventory') f.completionHost.readCurrent = async () => { const result = f.snapshot(); mutate(); return result; };
    if (stage === 'replay') { const original = f.replay.getMockImplementation()!; f.replay.mockImplementation(async input => { const result = await original(input); mutate(); return result; }); }
    await expect(f.service.resolve(f.input)).rejects.toThrow(/^GOAL_ROUTE_RESUME_FAILED$/);
  });
  it.each(['segment', 'anchor', 'inventory', 'replay'])('forwards the same signal and stops after %s abort', async stage => {
    const f = fixture(stage === 'replay' ? 'artifact' : stage === 'inventory' ? 'continue' : 'projection');
    if (stage === 'segment') f.read.mockImplementation(async (_run, signal) => { expect(signal).toBe(f.input.signal); f.controller.abort(); return structuredClone(f.segment()); });
    if (stage === 'anchor') f.verify.mockImplementation(async input => { expect(input.signal).toBe(f.input.signal); f.controller.abort(); return { checkpointId: 'ack' }; });
    if (stage === 'inventory') f.completionHost.readCurrent = async (_run, signal) => { expect(signal).toBe(f.input.signal); f.controller.abort(); return f.snapshot(); };
    if (stage === 'replay') { const original = f.replay.getMockImplementation()!; f.replay.mockImplementation(async input => { expect(input.signal).toBe(f.input.signal); const result = await original(input); f.controller.abort(); return result; }); }
    await expect(f.service.resolve(f.input)).rejects.toThrow(/^GOAL_ROUTE_RESUME_FAILED$/);
  });
  it.each(['refs', 'provenance', 'root', 'revision', 'downgrade'])('rejects authoritative completion snapshot %s mismatch', async kind => {
    const f = fixture('continue'); f.completionHost.readCurrent = async () => {
      const snapshot = f.snapshot();
      if (kind === 'refs') snapshot.criterionEvidenceIds = { [f.criterionId]: [] };
      if (kind === 'provenance') Reflect.set(snapshot.provenance.checkpoint, 'checkpointId', 'different');
      if (kind === 'root') snapshot.rootSessionId = 'foreign'; if (kind === 'revision') snapshot.stateRevision++;
      if (kind === 'downgrade') Reflect.deleteProperty(snapshot, 'provenance'); return snapshot;
    };
    await expect(f.service.resolve(f.input)).rejects.toThrow(/^GOAL_ROUTE_RESUME_FAILED$/);
  });
  it.each(['false-replay', 'foreign-binding', 'missing-receipt', 'missing-port'])('artifact %s never invokes fresh semantic authorization', async kind => {
    const f = fixture('artifact');
    if (kind === 'missing-receipt') { const state = f.load(); f.repository.compareAndSwap('run', state.stateRevision, { rootSessionId: 'root', packet: state.packet, updatedAt: 4 }); f.event.data!.goalBinding = goalPhaseBinding(f.load()); }
    if (kind === 'false-replay' || kind === 'foreign-binding') { const original = f.replay.getMockImplementation()!; f.replay.mockImplementation(async input => {
      const result = await original(input); return kind === 'false-replay' ? { ...result, replayed: false } : { ...result, binding: { ...result.binding, evidenceFingerprint: 'f'.repeat(64) } };
    }); }
    const service = kind === 'missing-port' ? new ArchitectureGoalRouteResumeService(f.repository, f.host, f.completionHost, {} as GoalRouteCompletionReplayPort) : f.service;
    await expect(service.resolve(f.input)).rejects.toThrow(/^GOAL_ROUTE_RESUME_FAILED$/);
  });
  it('rechecks durable segment drift without relying on a repository revision bump', async () => {
    const f = fixture(); f.verify.mockImplementation(async () => { f.segment().admissionCheckpointId = 'replaced'; return { checkpointId: 'ack' }; });
    await expect(f.service.resolve(f.input)).rejects.toThrow(/^GOAL_ROUTE_RESUME_FAILED$/);
  });
  it('reads real SQLite admission/route ACKs rather than the caller projection', async () => {
    const f = fixture();
    await f.audit.logRequired('durable-admission', { sessionId: 'root', type: 'architecture_event', label: 'fixture:readmission',
      data: { runId: 'run', rootSessionId: 'root', schemaId: 'schema', sourceFingerprint: f.load().packet.sourceFingerprint } });
    await f.audit.logRequired('durable-route', { sessionId: 'root', type: 'architecture_event', label: 'fixture:required-route',
      data: { runId: 'run', rootSessionId: 'root', schemaId: 'schema', event: f.event } });
    const rows = () => f.audit.listEntries({ source: 'all', runId: 'run', sessionId: 'root', limit: 100 });
    f.read.mockImplementation(async () => {
      const stored = await rows(); const admission = stored.find(row => row.id === 'durable-admission'); const route = stored.find(row => row.id === 'durable-route');
      if (!admission || !route || admission.data?.sourceFingerprint !== f.load().packet.sourceFingerprint) throw new Error('fixture-records');
      return { admissionCheckpointId: admission.id, topology: f.segment().topology, events: [route.data!.event as ArchitectureExecutionEvent] };
    });
    f.verify.mockImplementation(async input => {
      const stored = (await rows()).find(row => row.id === 'durable-route'); const event = stored?.data?.event as ArchitectureExecutionEvent | undefined;
      if (!event || event.id !== input.candidate.anchorEventId || JSON.stringify(event.data?.goalBinding) !== JSON.stringify(input.candidate.goalBinding)
        || input.candidate.sourceNodeId !== 'judge' || input.candidate.cursorCandidate.visitCounts.judge !== 1) throw new Error('fixture-anchor');
      return { checkpointId: stored!.id };
    });
    f.input.events = []; await expect(f.service.resolve(f.input)).resolves.toMatchObject({ pendingNodeIds: ['worker'] });
  });
  it('uses the real parent replay-only service and required ACK without selecting Jev', async () => {
    const f = fixture('artifact'); const select = vi.fn(async () => { throw new Error('Unexpected semantic selection'); });
    const review = { select } as unknown as ArchitectureGoalCompletionReviewService;
    const verify = vi.fn(async (): Promise<void> => undefined); // Producer trust remains a fixture authority.
    const authorization = new ArchitectureGoalCompletionAuthorizationService(f.repository, review, {
      verifyDurableInventory: verify,
      acknowledgeFinalizationRequired: async (run, state) => f.audit.logRequired(`${run.id}:goal-completion:${state.stateRevision}`, {
        sessionId: run.rootSessionId, type: 'architecture_event', label: 'fixture:completion-replay', data: { runId: run.id, rootSessionId: run.rootSessionId, binding: state.completionAuthorization?.binding } }),
    });
    const service = new ArchitectureGoalRouteResumeService(f.repository, f.host, f.completionHost, authorization);
    await expect(service.resolve(f.input)).resolves.toMatchObject({ pendingNodeIds: ['end'] }); expect(select).not.toHaveBeenCalled();
    const rows = await f.audit.listEntries({ source: 'all', runId: 'run', sessionId: 'root', limit: 100 });
    expect(rows.some(row => row.id === `run:goal-completion:${f.load().stateRevision}`)).toBe(true);
  });
  it('rejects snapshot getters without invoking them', async () => {
    const f = fixture('continue'); const getter = vi.fn(() => 'PRIVATE'); f.completionHost.readCurrent = async () => {
      const snapshot = f.snapshot(); Object.defineProperty(snapshot, 'host', { enumerable: true, get: getter }); return snapshot;
    };
    await expect(f.service.resolve(f.input)).rejects.toThrow(/^GOAL_ROUTE_RESUME_FAILED$/); expect(getter).not.toHaveBeenCalled();
  });
  it('sanitizes a private abort reason before touching durable authorities', async () => {
    const f = fixture(); f.controller.abort(new Error('PRIVATE abort detail'));
    await expect(f.service.resolve(f.input)).rejects.toThrow(/^GOAL_ROUTE_RESUME_FAILED$/);
    expect(f.read).not.toHaveBeenCalled(); expect(f.verify).not.toHaveBeenCalled();
  });
  it('rejects proxy snapshot data without running its reflection traps', async () => {
    const f = fixture('continue'); const trap = vi.fn(() => { throw new Error('PRIVATE'); });
    f.completionHost.readCurrent = async () => new Proxy(f.snapshot(), { ownKeys: trap });
    await expect(f.service.resolve(f.input)).rejects.toThrow(/^GOAL_ROUTE_RESUME_FAILED$/); expect(trap).not.toHaveBeenCalled();
  });
  it('rejects refs changed only on the post-verification snapshot read', async () => {
    const f = fixture('continue'); let reads = 0;
    f.completionHost.readCurrent = async () => {
      const snapshot = f.snapshot(); if (reads++ > 0) snapshot.criterionEvidenceIds = { [f.criterionId]: [] }; return snapshot;
    };
    await expect(f.service.resolve(f.input)).rejects.toThrow(/^GOAL_ROUTE_RESUME_FAILED$/);
  });
  it('rejects input accessors installed during host verification without invoking them', async () => {
    const f = fixture(); const getter = vi.fn(() => f.run);
    f.verify.mockImplementation(async () => {
      Object.defineProperty(f.input, 'run', { enumerable: true, get: getter }); return { checkpointId: 'ack' };
    });
    await expect(f.service.resolve(f.input)).rejects.toThrow(/^GOAL_ROUTE_RESUME_FAILED$/); expect(getter).not.toHaveBeenCalled();
  });
  it('detaches the executable cursor from both diagnostic input and host records', async () => {
    const f = fixture(); const cursor = await f.service.resolve(f.input);
    if (cursor.reason !== 'runtime_recovery') throw new Error('fixture'); cursor.pendingNodeIds.push('foreign'); cursor.visitCounts.judge = 99;
    expect(f.event.data!.pendingNodeIds).toEqual(['worker']); expect(f.event.data!.visitCounts).toEqual({ judge: 1 });
  });
});
