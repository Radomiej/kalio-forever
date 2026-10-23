import { Injectable } from '@nestjs/common';
import type { ArchitectureGoalPacketV1, ArchitectureGoalSourceV1, WorkflowEvidenceKind } from '@kalio/types';
import { and, eq } from 'drizzle-orm';
import { DrizzleService } from '../../database/drizzle.service';
import { architectureGoalStates } from '../../database/schema';
import { appendGoalSource, createGoalPacket } from './architecture-goal-source';
import { assertGoalProjectionHistory, prepareGoalProjection } from './architecture-goal-projection';
import { cloneGoalCompletionJson, validateGoalCompletionState, type GoalCompletionReceiptV2, type GoalEvidenceInventoryInput, type GoalCompletionStoredState } from './architecture-goal-completion-state';

export interface ArchitectureGoalState extends GoalCompletionStoredState {
  runId: string;
  rootSessionId: string;
  stateRevision: number;
  packet: ArchitectureGoalPacketV1;
  createdAt: number;
  updatedAt: number;
}

type GoalRow = typeof architectureGoalStates.$inferSelect;
const evidenceKinds: Record<WorkflowEvidenceKind, true> = {
  BUILD_RESULT: true, GIT_STATUS: true, FINAL_ARTIFACT: true, QUALITY_GATE: true,
  TOOL_RESULT: true, CLI_CHILD: true, VFS_WRITE: true, VFS_READ: true,
};

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonempty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function positiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
}

function timestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function invalid(): never { throw new Error('GOAL_STATE_CORRUPT'); }

function storage<T>(operation: () => T): T {
  try {
    return operation();
  } catch {
    // Driver errors may carry SQL parameters containing the canonical packet.
    throw new Error('GOAL_STATE_STORAGE_ERROR');
  }
}

function source(value: unknown): ArchitectureGoalSourceV1 {
  if (!record(value) || !nonempty(value.messageId) || !nonempty(value.sessionId)
    || !nonempty(value.turnId) || !nonempty(value.content) || !timestamp(value.createdAt)) invalid();
  return value as unknown as ArchitectureGoalSourceV1;
}

function validatePacket(value: unknown): ArchitectureGoalPacketV1 {
  if (!record(value) || value.schemaVersion !== 1 || !positiveInteger(value.version)
    || !Array.isArray(value.updates) || value.version !== value.updates.length + 1
    || !record(value.projection) || !record(value.completionPolicy)
    || !record(value.completionPolicy.requiredEvidenceKindsByCriterion)) invalid();
  let rebuilt = createGoalPacket(source(value.original));
  const seen = new Set([rebuilt.original.messageId]);
  for (const item of value.updates) {
    const update = source(item);
    if (seen.has(update.messageId)) invalid();
    seen.add(update.messageId);
    rebuilt = appendGoalSource(rebuilt, update);
  }
  if (value.sourceFingerprint !== rebuilt.sourceFingerprint) invalid();
  const projection = value.projection;
  if (projection.status !== 'pending' && projection.status !== 'accepted') invalid();
  const accepted = projection.status === 'accepted';
  const base = accepted ? projection.snapshot : projection.base;
  if (base !== null || accepted) {
    if (!record(base) || !positiveInteger(base.sourceVersion) || base.sourceVersion > value.version
      || (!accepted && base.sourceVersion >= value.version)
      || (accepted && base.sourceVersion !== value.version) || !nonempty(base.goalFingerprint)) invalid();
  }
  // Narrowing the envelope is not proof of persisted projection integrity.
  // The projection owner validates canonical IDs, hashes, supersession and quote provenance.
  const packet = value as unknown as ArchitectureGoalPacketV1;
  try { assertGoalProjectionHistory(packet); } catch { return invalid(); }
  if (!accepted && projection.proposal !== undefined) {
    const proposal = projection.proposal;
    if (!record(proposal) || proposal.sourceVersion !== value.version || !nonempty(proposal.proposalFingerprint)) invalid();
    try {
      const calculated = prepareGoalProjection(packet, { sourceVersion: proposal.sourceVersion, criteria: proposal.criteria });
      if (calculated.proposalFingerprint !== proposal.proposalFingerprint) invalid();
    } catch { return invalid(); }
  }
  for (const [id, kinds] of Object.entries(value.completionPolicy.requiredEvidenceKindsByCriterion)) {
    if (!nonempty(id) || !Array.isArray(kinds) || kinds.length === 0 || new Set(kinds).size !== kinds.length
      || !kinds.every(kind => typeof kind === 'string' && Object.hasOwn(evidenceKinds, kind))) invalid();
  }
  if (packet.projection.status === 'accepted') {
    const rows = packet.projection.snapshot.criteria;
    const superseded = new Set(rows.flatMap(row => row.supersedes));
    const active = rows.filter(row => !superseded.has(row.id));
    const requirements = packet.completionPolicy.requiredEvidenceKindsByCriterion;
    if (!active.length || Object.keys(requirements).length !== active.length
      || active.some(row => !Object.hasOwn(requirements, row.id))) invalid();
  }
  return packet;
}

function goalFingerprint(packet: ArchitectureGoalPacketV1): string | null {
  return packet.projection.status === 'accepted' ? packet.projection.snapshot.goalFingerprint : null;
}

function toRow(state: ArchitectureGoalState): GoalRow {
  if (!nonempty(state.runId) || !nonempty(state.rootSessionId) || !positiveInteger(state.stateRevision)
    || !timestamp(state.createdAt) || !timestamp(state.updatedAt) || state.updatedAt < state.createdAt) invalid();
  const packet = validatePacket(state.packet);
  const completion = validateGoalCompletionState(state, state.evidenceInventory, state.completionAuthorization);
  return {
    runId: state.runId, rootSessionId: state.rootSessionId, stateRevision: state.stateRevision,
    sourceVersion: packet.version, projectionStatus: packet.projection.status,
    sourceFingerprint: packet.sourceFingerprint, goalFingerprint: goalFingerprint(packet),
    packetJson: JSON.stringify(packet), createdAt: state.createdAt, updatedAt: state.updatedAt,
    evidenceInventoryJson: completion.evidenceInventory === null ? null : JSON.stringify(completion.evidenceInventory),
    completionAuthorizationJson: completion.completionAuthorization === null ? null : JSON.stringify(completion.completionAuthorization),
  };
}

function fromRow(row: GoalRow): ArchitectureGoalState {
  try {
    const parsed: unknown = JSON.parse(row.packetJson);
    const packet = validatePacket(parsed);
    const state = { runId: row.runId, rootSessionId: row.rootSessionId, stateRevision: row.stateRevision,
      packet, createdAt: row.createdAt, updatedAt: row.updatedAt,
      ...validateGoalCompletionState({ runId: row.runId, rootSessionId: row.rootSessionId, stateRevision: row.stateRevision, packet },
        row.evidenceInventoryJson === null ? null : JSON.parse(row.evidenceInventoryJson) as unknown,
        row.completionAuthorizationJson === null ? null : JSON.parse(row.completionAuthorizationJson) as unknown) };
    toRow(state);
    if (row.sourceVersion !== packet.version || row.projectionStatus !== packet.projection.status
      || row.sourceFingerprint !== packet.sourceFingerprint || row.goalFingerprint !== goalFingerprint(packet)) invalid();
    return state;
  } catch {
    // Never include parse errors: they can contain canonical user content.
    return invalid();
  }
}

@Injectable()
export class ArchitectureGoalRepository {
  constructor(private readonly drizzle: DrizzleService) {}

  load(runId: string, rootSessionId?: string): ArchitectureGoalState | null {
    const row = storage(() => this.drizzle.db.select().from(architectureGoalStates)
      .where(eq(architectureGoalStates.runId, runId)).get());
    if (!row) return null;
    const state = fromRow(row);
    if (rootSessionId !== undefined && state.rootSessionId !== rootSessionId) {
      throw new Error('GOAL_STATE_OWNERSHIP');
    }
    return state;
  }

  create(input: Omit<ArchitectureGoalState, 'stateRevision' | keyof GoalCompletionStoredState>): ArchitectureGoalState {
    const row = toRow({ ...input, stateRevision: 1, evidenceInventory: null, completionAuthorization: null });
    const result = storage(() => this.drizzle.db.insert(architectureGoalStates).values(row)
      .onConflictDoNothing({ target: architectureGoalStates.runId }).run());
    if (result.changes !== 1) throw new Error('GOAL_STATE_CONFLICT');
    return fromRow(row);
  }

  compareAndSwap(runId: string, expectedRevision: number,
    next: Pick<ArchitectureGoalState, 'rootSessionId' | 'packet' | 'updatedAt'>): ArchitectureGoalState {
    if (!positiveInteger(expectedRevision)) throw new Error('GOAL_STATE_CONFLICT');
    const existing = this.load(runId, next.rootSessionId);
    if (!existing || existing.stateRevision !== expectedRevision) throw new Error('GOAL_STATE_CONFLICT');
    return this.writeCas(existing, { ...existing, ...next, stateRevision: expectedRevision + 1,
      evidenceInventory: null, completionAuthorization: null });
  }

  replaceEvidenceInventory(runId: string, expectedRevision: number, rootSessionId: string,
    inventory: GoalEvidenceInventoryInput, updatedAt: number): ArchitectureGoalState {
    const existing = this.current(runId, expectedRevision, rootSessionId);
    const cloned = cloneGoalCompletionJson(inventory);
    if (!record(cloned) || Object.hasOwn(cloned, 'inventoryStateRevision')) invalid();
    return this.writeCas(existing, { ...existing, stateRevision: expectedRevision + 1, updatedAt,
      evidenceInventory: { ...cloned, inventoryStateRevision: expectedRevision + 1 }, completionAuthorization: null });
  }

  /** Persisted consistency only; authorized host service must prove provenance and real Jev choice. */
  authorizeCompletion(runId: string, expectedRevision: number, rootSessionId: string,
    receipt: Omit<GoalCompletionReceiptV2, 'authorizedStateRevision'>, updatedAt: number): ArchitectureGoalState {
    const existing = this.current(runId, expectedRevision, rootSessionId);
    if (existing.completionAuthorization !== null) throw new Error('GOAL_STATE_CONFLICT');
    const cloned = cloneGoalCompletionJson(receipt);
    if (!record(cloned) || Object.hasOwn(cloned, 'authorizedStateRevision') || cloned.schemaVersion !== 2
      || existing.evidenceInventory?.schemaVersion !== 2) invalid();
    return this.writeCas(existing, { ...existing, stateRevision: expectedRevision + 1, updatedAt,
      completionAuthorization: { ...cloned, authorizedStateRevision: expectedRevision + 1 } });
  }

  private current(runId: string, expectedRevision: number, rootSessionId: string): ArchitectureGoalState {
    if (!positiveInteger(expectedRevision)) throw new Error('GOAL_STATE_CONFLICT');
    const existing = this.load(runId, rootSessionId);
    if (!existing || existing.stateRevision !== expectedRevision) throw new Error('GOAL_STATE_CONFLICT');
    return existing;
  }

  private writeCas(existing: ArchitectureGoalState, next: ArchitectureGoalState): ArchitectureGoalState {
    const row = toRow(next);
    const result = storage(() => this.drizzle.db.update(architectureGoalStates).set({
      stateRevision: row.stateRevision, sourceVersion: row.sourceVersion,
      projectionStatus: row.projectionStatus, sourceFingerprint: row.sourceFingerprint,
      goalFingerprint: row.goalFingerprint, packetJson: row.packetJson, updatedAt: row.updatedAt,
      evidenceInventoryJson: row.evidenceInventoryJson, completionAuthorizationJson: row.completionAuthorizationJson,
    }).where(and(eq(architectureGoalStates.runId, existing.runId),
      eq(architectureGoalStates.stateRevision, existing.stateRevision),
      eq(architectureGoalStates.rootSessionId, existing.rootSessionId))).run());
    if (result.changes !== 1) throw new Error('GOAL_STATE_CONFLICT');
    return fromRow(row);
  }
}
