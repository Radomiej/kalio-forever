import type { ArchitectureExecutionEvent, ArchitectureRun, ArchitectureSchema } from '@kalio/types';
import { describe, expect, it, vi } from 'vitest';
import type { ArchitectureGoalRepository, ArchitectureGoalState } from './architecture-goal.repository';
import { createGoalPacket } from './architecture-goal-source';
import { appendGoalSource } from './architecture-goal-source';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { resolve } from 'node:path';
import type { DrizzleService } from '../../database/drizzle.service';
import * as databaseSchema from '../../database/schema';
import { ArchitectureGoalRepository as GoalRepository } from './architecture-goal.repository';
import { AuditService as DurableAuditService } from '../chat/audit.service';
import { ArchitectureGoalAuditService } from './architecture-goal-audit.service';
import { acceptGoalProjection, goalProjectionPolicyTargets, prepareGoalProjection } from './architecture-goal-projection';
import type { AuditLogEntry, AuditLogInput, AuditService } from '../chat/audit.service';
import type { SessionsService } from '../chat/sessions.service';
import { ArchitectureRuntimeAuditRecoveryService } from './architecture-runtime-audit-recovery.service';
import { ArchitectureRuntimeAuditWriterService } from './architecture-runtime-audit.service';
import { mergeArchitectureRuntimeEvents, recoverAutoRoutingCursor } from './architecture-runtime-auto-routing-recovery.utils';

const schema: ArchitectureSchema = {
  id: 'schema', name: 'Recovery', description: 'Durable checkpoint fixture', version: '1', roleSlots: [],
  nodes: [{ id: 'auto', kind: 'auto_router', label: 'Auto' }, { id: 'next', kind: 'artifact', label: 'Next' }],
  edges: [{ id: 'opaque-edge', fromNodeId: 'auto', toNodeId: 'next', selection: 'choice' }],
  routerPolicy: { mode: 'evidence_first', mustAddressCriticFindings: false, canReturnNeedsMoreResearch: false },
  contextPolicy: { includeUserTask: true, includeProjectMemory: false, includeBrowserSession: false, includePriorDecisions: false },
  memoryPolicy: { persistFinalArtifact: true, persistRouterDecision: true }, outputArtifactSchema: 'markdown',
};

function checkpoint(patch: Record<string, unknown> = {}): AuditLogEntry {
  return {
    id: 'opaque-row', sessionId: 'host', type: 'architecture_event', label: 'Display only',
    durationMs: null, chunkCount: null, createdAt: 100,
    data: {
      domain: 'architecture', kind: 'architecture_event', runId: 'run', architectureRunId: 'run',
      schemaId: 'schema', eventId: 'opaque-event/with:no:meaning', eventType: 'router_decision', sequence: 3,
      nodeId: 'auto', route: {
        source: 'jev_choice', fromNodeId: 'auto', selectedNodeIds: ['next'], nextNodeId: 'next',
        selectedEdgeId: 'opaque-edge', confidence: 0.9, decisionReason: 'selected',
      },
      autoRoutingVisit: 2, selectedEdgeId: 'opaque-edge', pendingNodeIds: ['next'],
      visitCounts: { auto: 2 }, selectedNodeIds: ['next'], ...patch,
    },
  };
}

function recovery(rows: AuditLogEntry[]) {
  const listEntries = vi.fn().mockResolvedValue(rows);
  const listChildren = vi.fn().mockResolvedValue([]);
  const service = new ArchitectureRuntimeAuditRecoveryService(
    { listChildren } as unknown as SessionsService,
    { listEntries } as unknown as AuditService,
  );
  return { service, listEntries, listChildren };
}

function goalState(): ArchitectureGoalState {
  return { runId: 'run', rootSessionId: 'root', stateRevision: 3, createdAt: 1, updatedAt: 2,
    evidenceInventory: null, completionAuthorization: null,
    packet: createGoalPacket({ messageId: 'source', sessionId: 'host', turnId: 'turn', content: '  Canonical human goal\n', createdAt: 1 }) };
}

function goalMarker(patch: Record<string, unknown> = {}): AuditLogEntry {
  return { id: 'run:goal-state:3', sessionId: 'root', type: 'architecture_event',
    label: 'architecture_event:goal_protocol', durationMs: null, chunkCount: null, createdAt: 200,
    data: { domain: 'architecture', kind: 'architecture_event', eventType: 'goal_protocol', schemaVersion: 1,
      runId: 'run', schemaId: 'schema', rootSessionId: 'root', stateRevision: 3, sourceVersion: 1,
      projectionStatus: 'pending', sourceFingerprint: goalState().packet.sourceFingerprint, goalFingerprint: null,
      sourceMessageIds: ['source'], ...patch } };
}

function goalRecovery(markers = [goalMarker()], load?: (runId: string, rootSessionId?: string) => ArchitectureGoalState | null) {
  const created = checkpoint({ eventType: 'run_created', route: undefined, prompt: 'Legacy worker prompt', rootSessionId: 'root' });
  for (const key of ['autoRoutingVisit', 'selectedEdgeId', 'pendingNodeIds', 'visitCounts', 'selectedNodeIds']) delete created.data?.[key];
  const repository = load ? { load } as unknown as ArchitectureGoalRepository : undefined;
  return new ArchitectureRuntimeAuditRecoveryService(
    { listChildren: vi.fn().mockResolvedValue([]) } as unknown as SessionsService,
    { listEntries: vi.fn().mockResolvedValue([created, ...markers]) } as unknown as AuditService,
    repository,
  );
}

function finalArtifact(): AuditLogEntry {
  return { ...goalMarker(), id: 'final', data: { domain: 'architecture', kind: 'architecture_event',
    eventType: 'final_artifact', runId: 'run', schemaId: 'schema', rootSessionId: 'root',
    eventId: 'final-event', sequence: 5, messagePreview: 'Generic final artifact' } };
}

describe('canonical goal audit recovery', () => {
  it('preserves generic final artifact completion only for marker-free legacy runs', async () => {
    const service = goalRecovery([finalArtifact()], () => { throw new Error('Must not load goal state'); });
    expect((await service.reconstructRun('run'))?.status).toBe('completed');
  });

  it.each(['pending', 'accepted'] as const)('rejects generic completion for %s goal projection without durable authorization', async status => {
    const current = goalState();
    if (status === 'accepted') {
      const proposal = prepareGoalProjection(current.packet, { sourceVersion: 1, criteria: [{
        text: 'Canonical human goal', sourceQuotes: [{ messageId: 'source', quote: 'Canonical human goal' }], supersedes: [],
      }] });
      current.packet.projection = { status: 'pending', base: null, proposal };
      const policy = { requiredEvidenceKindsByCriterion: Object.fromEntries(
        goalProjectionPolicyTargets(current.packet, proposal).map(row => [row.id, ['BUILD_RESULT']]),
      ) };
      current.packet = acceptGoalProjection(current.packet, proposal, policy, { sourceVersion: 1,
        sourceFingerprint: current.packet.sourceFingerprint, proposalFingerprint: proposal.proposalFingerprint, accepted: true });
    }
    const service = goalRecovery([goalMarker(), finalArtifact()], () => current);
    await expect(service.reconstructRun('run')).rejects.toThrow(/^GOAL_RECOVERY_COMPLETION_UNVERIFIED$/);
    await expect(service.reconstructEvents('run')).rejects.toThrow(/^GOAL_RECOVERY_COMPLETION_UNVERIFIED$/);
  });

  it('leaves marker-free legacy recovery unchanged and does not consult goal storage', async () => {
    const load = vi.fn(() => { throw new Error('Must not load'); });
    const service = goalRecovery([], load);
    expect((await service.reconstructRun('run'))?.prompt).toBe('Legacy worker prompt');
    expect((await service.reconstructRun('run'))?.goalPacket).toBeUndefined();
    expect(load).not.toHaveBeenCalled();
  });

  it('hydrates canonical packet and original prompt using exact run/root, not lifecycle marker text', async () => {
    const state = goalState();
    const load = vi.fn(() => state);
    const service = goalRecovery([goalMarker()], load);
    expect(await service.reconstructRun('run')).toMatchObject({ goalPacket: state.packet,
      prompt: '  Canonical human goal\n', rootSessionId: 'root' });
    expect(load).toHaveBeenCalledWith('run', 'root');
    expect((await service.reconstructEvents('run')).map(event => event.type)).toEqual(['run_created']);
  });

  it('accepts markers lagging a canonical CAS revision', async () => {
    const service = goalRecovery([goalMarker({ stateRevision: 1 })], () => goalState());
    expect((await service.reconstructRun('run'))?.goalPacket).toEqual(goalState().packet);
  });

  it.each([
    ['missing store', undefined, 'GOAL_RECOVERY_STORE_UNAVAILABLE'],
    ['missing row', (): null => null, 'GOAL_RECOVERY_STATE_MISSING'],
    ['corrupt row', (): never => { throw new Error('secret content: malformed database'); }, 'GOAL_RECOVERY_STATE_INVALID'],
    ['foreign root', (): ArchitectureGoalState => ({ ...goalState(), rootSessionId: 'foreign' }), 'GOAL_RECOVERY_STATE_MISMATCH'],
    ['foreign run', (): ArchitectureGoalState => ({ ...goalState(), runId: 'foreign' }), 'GOAL_RECOVERY_STATE_MISMATCH'],
  ] as const)('fails closed for %s in run and event recovery', async (_name, load, error) => {
    const service = goalRecovery([goalMarker()], load);
    await expect(service.reconstructRun('run')).rejects.toThrow(new RegExp(`^${error}$`));
    await expect(service.reconstructEvents('run')).rejects.toThrow(new RegExp(`^${error}$`));
  });

  it.each([
    { schemaVersion: 2 }, { schemaVersion: undefined }, { runId: 'foreign', architectureRunId: 'run' },
    { rootSessionId: 'foreign' }, { rootSessionId: undefined }, { stateRevision: 0 },
    { stateRevision: 1.5 }, { sourceVersion: 0 }, { sourceVersion: '1' },
  ])('rejects malformed marker metadata %j', async patch => {
    const service = goalRecovery([goalMarker(patch)], () => goalState());
    await expect(service.reconstructRun('run')).rejects.toThrow(/^GOAL_RECOVERY_MARKER_INVALID$/);
  });

  it.each([{ stateRevision: 4 }, { sourceVersion: 2 }])('rejects future marker %j relative to canonical DB', async patch => {
    const service = goalRecovery([goalMarker(patch)], () => goalState());
    await expect(service.reconstructRun('run')).rejects.toThrow(/^GOAL_RECOVERY_MARKER_FUTURE$/);
  });

  it('does not ignore a malformed older marker when a newer valid marker exists', async () => {
    const service = goalRecovery([goalMarker({ stateRevision: 0 }), goalMarker()], () => goalState());
    await expect(service.reconstructRun('run')).rejects.toThrow(/^GOAL_RECOVERY_MARKER_INVALID$/);
  });

  it('requires a recovered root instead of legacy fallback for a goal-enabled run', async () => {
    const marker = { ...goalMarker(), sessionId: null, data: { ...goalMarker().data, rootSessionId: undefined } };
    const service = new ArchitectureRuntimeAuditRecoveryService(
      { listChildren: vi.fn().mockResolvedValue([]) } as unknown as SessionsService,
      { listEntries: vi.fn().mockResolvedValue([marker]) } as unknown as AuditService,
      { load: vi.fn(() => goalState()) } as unknown as ArchitectureGoalRepository,
    );
    await expect(service.reconstructRun('run')).rejects.toThrow(/^GOAL_RECOVERY_ROOT_MISSING$/);
  });

  it('recovers through real SQLite repository/audit, accepts CAS lag and rejects corrupt canonical data', async () => {
    const client = new Database(':memory:');
    try {
      const db = drizzle(client, { schema: databaseSchema });
      migrate(db, { migrationsFolder: resolve(__dirname, '../../database/migrations') });
      const dependency = { db } as unknown as DrizzleService;
      const repository = new GoalRepository(dependency);
      const audit = new DurableAuditService(dependency);
      const sourceState = goalState();
      const created = repository.create(sourceState);
      await new ArchitectureGoalAuditService(audit).persistRequired({ id: 'run', rootSessionId: 'root', schemaId: 'schema' }, created);
      const next = appendGoalSource(created.packet, { ...created.packet.original, messageId: 'update', turnId: 'turn-2', content: 'New goal requirement' });
      repository.compareAndSwap('run', 1, { rootSessionId: 'root', packet: next, updatedAt: 3 });
      const service = new ArchitectureRuntimeAuditRecoveryService(
        { listChildren: vi.fn().mockResolvedValue([]) } as unknown as SessionsService,
        audit, new GoalRepository(dependency),
      );
      expect(await service.reconstructRun('run')).toMatchObject({ prompt: '  Canonical human goal\n', goalPacket: next });
      await expect(service.reconstructEvents('run')).resolves.toEqual([]);
      client.exec("UPDATE architecture_goal_states SET packet_json = '{secret raw goal'");
      await expect(service.reconstructRun('run')).rejects.toThrow(/^GOAL_RECOVERY_STATE_INVALID$/);
      await expect(service.reconstructEvents('run')).rejects.toThrow(/^GOAL_RECOVERY_STATE_INVALID$/);
    } finally { client.close(); }
  });
});

describe('durable audit checkpoint recovery', () => {
  it.each(['jev_choice', 'runtime_fallback'] as const)('round trips the real AuditWriter %s row after JSON persistence', async (source) => {
    const rows: AuditLogEntry[] = [];
    const logRequired = vi.fn(async (id: string, input: AuditLogInput) => {
      rows.push({ id, sessionId: input.sessionId ?? null, type: input.type, label: input.label,
        data: JSON.parse(JSON.stringify(input.data)) as Record<string, unknown>,
        durationMs: null, chunkCount: null, createdAt: 100 });
    });
    const writer = new ArchitectureRuntimeAuditWriterService({ logRequired } as unknown as AuditService);
    const run: ArchitectureRun = { id: 'run', schemaId: schema.id, prompt: 'Resume', status: 'running',
      rootSessionId: 'host', createdAt: 1, updatedAt: 1, executionMode: 'subagent_execution' };
    const event: ArchitectureExecutionEvent = {
      id: 'opaque-event', runId: run.id, sequence: 3, type: 'router_decision', nodeId: 'auto', message: 'Continue', createdAt: 100,
      route: { source, fromNodeId: 'auto', selectedNodeIds: ['next'], nextNodeId: 'next', selectedEdgeId: 'opaque-edge',
        confidence: 0.9, decisionReason: 'selected' },
      data: { kind: 'auto_routing_decision', autoRoutingVisit: 2, selectedEdgeId: 'opaque-edge',
        pendingNodeIds: ['next'], visitCounts: { auto: 2 }, selectedNodeIds: ['next'] },
    };
    await writer.logRouteDecisionRequired(schema, run, event, 'opaque-checkpoint');
    const events = await recovery(rows).service.reconstructEvents(run.id, 'host');
    expect(events[0]).toMatchObject({ id: event.id, sequence: event.sequence, route: event.route, data: event.data });
    expect(recoverAutoRoutingCursor(schema, events)).toMatchObject({ pendingNodeIds: ['next'], visitCounts: { auto: 2 } });
  });

  it('normalizes the AuditWriter root fields and feeds the restart cursor without interpreting ids', async () => {
    const row = checkpoint();
    const { service, listEntries } = recovery([row]);
    const events = await service.reconstructEvents('run');
    expect(events[0]).toMatchObject({
      id: row.data?.eventId, sequence: 3, route: row.data?.route,
      data: { kind: 'auto_routing_decision', autoRoutingVisit: 2, selectedEdgeId: 'opaque-edge',
        selectedNodeIds: ['next'], pendingNodeIds: ['next'], visitCounts: { auto: 2 } },
    });
    expect(recoverAutoRoutingCursor(schema, events)).toEqual({
      reason: 'runtime_recovery', pendingNodeIds: ['next'], visitCounts: { auto: 2 },
    });
    expect(mergeArchitectureRuntimeEvents(events, await service.reconstructEvents('run'))).toHaveLength(1);
    expect(row.data?.kind).toBe('architecture_event');
    expect(listEntries).toHaveBeenCalledWith(expect.objectContaining({ runId: 'run', limit: 5000, source: 'all' }));
  });

  it('retains default fallback checkpoints and ordinary typed routes', async () => {
    const row = checkpoint();
    const route = { ...row.data?.route as Record<string, unknown>, source: 'runtime_fallback', decisionReason: 'provider_error' };
    const ordinary = checkpoint({ eventId: 'ordinary', eventType: 'participant_output',
      route: { source: 'runtime_fallback', fromNodeId: 'auto', selectedNodeIds: ['next'], nextNodeId: 'next' } });
    for (const key of ['autoRoutingVisit', 'selectedEdgeId', 'pendingNodeIds', 'visitCounts', 'selectedNodeIds']) delete ordinary.data?.[key];
    const { service } = recovery([checkpoint({ route }), ordinary]);
    const events = await service.reconstructEvents('run');
    expect(events[0]?.route).toMatchObject({ source: 'runtime_fallback' });
    expect(events[0]?.data?.kind).toBe('auto_routing_decision');
    expect(events[1]?.data?.kind).toBe('architecture_event');
  });

  it.each([
    ['autoRoutingVisit', undefined], ['autoRoutingVisit', 0], ['autoRoutingVisit', 1.5],
    ['autoRoutingVisit', NaN], ['selectedEdgeId', undefined], ['selectedEdgeId', 'wrong'],
    ['pendingNodeIds', undefined], ['pendingNodeIds', [42]], ['pendingNodeIds', []],
    ['visitCounts', undefined], ['visitCounts', { auto: -1 }], ['visitCounts', { auto: 1.5 }],
    ['visitCounts', {}], ['selectedNodeIds', undefined], ['selectedNodeIds', ['wrong']],
    ['eventId', undefined], ['sequence', -1], ['nodeId', undefined], ['route', undefined],
    ['eventType', undefined], ['eventType', 'final_artifact'],
  ])('fails closed for malformed or missing %s (%j)', async (field, value) => {
    const { service } = recovery([checkpoint({ [field]: value })]);
    await expect(service.reconstructEvents('run')).rejects.toThrow(/checkpoint/i);
    await expect(service.reconstructRun('run')).rejects.toThrow(/checkpoint/i);
  });

  it('does not classify labels or opaque ids as checkpoint metadata', async () => {
    const ordinary = checkpoint({ eventType: 'node_completed', route: undefined });
    for (const key of ['autoRoutingVisit', 'selectedEdgeId', 'pendingNodeIds', 'visitCounts', 'selectedNodeIds']) delete ordinary.data?.[key];
    const { service } = recovery([ordinary]);
    await expect(service.reconstructEvents('run')).resolves.toMatchObject([{ type: 'node_completed', data: { kind: 'architecture_event' } }]);
  });

  it('rejects a saturated window instead of recovering from potentially truncated history', async () => {
    const { service, listEntries } = recovery(Array.from({ length: 5000 }, () => checkpoint()));
    await expect(service.reconstructEvents('run')).rejects.toThrow(/limit|truncated/i);
    expect(listEntries).toHaveBeenCalledTimes(1);
  });

  it('bounds reads by run and explicit session and never enumerates global sessions', async () => {
    const foreignRun = checkpoint({ runId: 'foreign', architectureRunId: 'foreign' });
    const foreignSession = { ...checkpoint(), sessionId: 'other-host' };
    const { service, listEntries, listChildren } = recovery([checkpoint(), foreignRun, foreignSession]);
    await expect(service.reconstructEvents('run', 'host')).resolves.toHaveLength(1);
    expect(listEntries).toHaveBeenCalledWith({ limit: 5000, source: 'all', runId: 'run', sessionId: 'host' });
    expect(listChildren).not.toHaveBeenCalled();
    await expect(service.reconstructEvents('', 'host')).rejects.toThrow(/scope/);
    await expect(service.reconstructEvents('run', '')).rejects.toThrow(/scope/);
    expect(listEntries).toHaveBeenCalledTimes(1);
  });
});
