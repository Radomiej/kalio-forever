import type { ArchitectureGoalPacketV1 } from '@kalio/types';
import { assertGoalCompletion, inspectGoalCompletion, prepareGoalCompletion,
  type GoalCompletionBinding, type GoalCompletionCandidate, type GoalCompletionHostEvidence } from './architecture-goal-completion';
import type { GoalCompletionProvenanceV2 } from './architecture-goal-provenance';

export interface GoalCompletionScope {
  readonly runId: string;
  readonly rootSessionId: string;
  readonly goalVersion: number;
  readonly sourceFingerprint: string;
}
export interface GoalEvidenceRef {
  readonly checkpointId: string;
  readonly eventId: string;
  readonly sequence: number;
  readonly evidenceIndex: number;
}
export interface GoalChildRef {
  readonly childId: string;
  readonly sessionId: string;
  readonly lifecycleCheckpointId: string;
}
export interface GoalEvidenceInventoryV1 extends GoalCompletionScope {
  readonly schemaVersion: 1;
  readonly inventoryStateRevision: number;
  readonly host: GoalCompletionHostEvidence;
  readonly evidenceRefsById: Readonly<Record<string, GoalEvidenceRef>>;
  readonly childRefsById: Readonly<Record<string, GoalChildRef>>;
  readonly supersededEvidenceIds: Readonly<Record<string, string>>;
}
export interface GoalEvidenceInventoryV2 extends GoalCompletionScope {
  readonly schemaVersion: 2;
  readonly inventoryStateRevision: number;
  readonly host: GoalCompletionHostEvidence;
  readonly provenance: GoalCompletionProvenanceV2;
}
export type GoalEvidenceInventory = GoalEvidenceInventoryV1 | GoalEvidenceInventoryV2;
export type GoalEvidenceInventoryInput = Omit<GoalEvidenceInventoryV1, 'inventoryStateRevision'>
  | Omit<GoalEvidenceInventoryV2, 'inventoryStateRevision'>;
export interface GoalCompletionReceiptV1 extends GoalCompletionScope {
  readonly schemaVersion: 1;
  readonly reviewedStateRevision: number;
  readonly authorizedStateRevision: number;
  readonly inventoryStateRevision: number;
  readonly choice: 'complete';
  readonly confidence: number;
  readonly binding: GoalCompletionBinding;
  readonly criterionEvidenceIds: GoalCompletionCandidate['criterionEvidenceIds'];
}
export interface GoalCompletionReceiptV2 extends Omit<GoalCompletionReceiptV1, 'schemaVersion'> {
  readonly schemaVersion: 2;
}
export type GoalCompletionReceipt = GoalCompletionReceiptV1 | GoalCompletionReceiptV2;
export interface GoalCompletionStorageContext {
  runId: string;
  rootSessionId: string;
  stateRevision: number;
  packet: ArchitectureGoalPacketV1;
}
export interface GoalCompletionStoredState {
  evidenceInventory: GoalEvidenceInventory | null;
  completionAuthorization: GoalCompletionReceipt | null;
}

function fail(): never { throw new Error('GOAL_STATE_CORRUPT'); }
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}
function exact(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return record(value) && Reflect.ownKeys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
function text(value: unknown): value is string { return typeof value === 'string' && value.trim().length > 0; }
function integer(value: unknown, minimum = 1): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum;
}

/** Strict cloned JSON boundary, not a second canonical hash implementation. */
function jsonClone(value: unknown, ancestors = new Set<object>()): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : fail();
  if (typeof value !== 'object' || ancestors.has(value) || ancestors.size >= 100) return fail();
  ancestors.add(value);
  try {
    const keys = Reflect.ownKeys(value);
    if (Array.isArray(value)) {
      if (keys.length !== value.length + 1) return fail();
      return Array.from({ length: value.length }, (_, index) => {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        return descriptor?.enumerable && 'value' in descriptor ? jsonClone(descriptor.value, ancestors) : fail();
      });
    }
    if (!record(value) || keys.some(key => typeof key !== 'string') || keys.length !== Object.keys(value).length) return fail();
    return Object.fromEntries(Object.keys(value).map(key => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable || !('value' in descriptor)) return fail();
      return [key, jsonClone(descriptor.value, ancestors)];
    }));
  } finally { ancestors.delete(value); }
}

/** Reject lossy/coercive input before a repository adds its own revision fields. */
export function cloneGoalCompletionJson<T>(value: T): T {
  try { return jsonClone(value) as T; } catch { return fail(); }
}

const scopeKeys = ['schemaVersion', 'runId', 'rootSessionId', 'goalVersion', 'sourceFingerprint'] as const;
function scope(value: Record<string, unknown>, context: GoalCompletionStorageContext): void {
  if (![1, 2].includes(value.schemaVersion as number) || value.runId !== context.runId || value.rootSessionId !== context.rootSessionId
    || value.goalVersion !== context.packet.version || value.sourceFingerprint !== context.packet.sourceFingerprint) fail();
}

function validateInventory(value: unknown, context: GoalCompletionStorageContext): GoalEvidenceInventory {
  if (record(value) && value.schemaVersion === 2) {
    if (!exact(value, [...scopeKeys, 'inventoryStateRevision', 'host', 'provenance'])
      || !integer(value.inventoryStateRevision) || value.inventoryStateRevision > context.stateRevision
      || context.packet.projection.status !== 'accepted') return fail();
    scope(value, context);
    const rows = context.packet.projection.snapshot.criteria;
    const superseded = new Set(rows.flatMap(row => row.supersedes));
    inspectGoalCompletion(context.packet, Object.fromEntries(rows.filter(row => !superseded.has(row.id)).map(row => [row.id, []])),
      value.host as GoalCompletionHostEvidence, { runId: context.runId, rootSessionId: context.rootSessionId, provenance: value.provenance });
    return value as unknown as GoalEvidenceInventoryV2;
  }
  if (!exact(value, [...scopeKeys, 'inventoryStateRevision', 'host', 'evidenceRefsById', 'childRefsById', 'supersededEvidenceIds'])
    || value.schemaVersion !== 1 || !integer(value.inventoryStateRevision) || value.inventoryStateRevision > context.stateRevision
    || !record(value.evidenceRefsById) || !record(value.childRefsById) || !record(value.supersededEvidenceIds)) return fail();
  scope(value, context);
  if (context.packet.projection.status !== 'accepted') return fail();
  const rows = context.packet.projection.snapshot.criteria;
  const supersededCriteria = new Set(rows.flatMap(row => row.supersedes));
  // Empty criterion refs validate incomplete inventories without claiming eligibility.
  inspectGoalCompletion(context.packet, Object.fromEntries(rows.filter(row => !supersededCriteria.has(row.id)).map(row => [row.id, []])),
    value.host as GoalCompletionHostEvidence);
  const host = value.host as GoalCompletionHostEvidence;
  const oldIds = Object.keys(value.supersededEvidenceIds);
  const activeIds = Object.keys(host.evidenceById);
  const expectedIds = [...activeIds, ...oldIds];
  if (new Set(expectedIds).size !== expectedIds.length || !exact(value.evidenceRefsById, expectedIds)
    || !exact(value.childRefsById, Object.keys(host.cliChildrenById))) return fail();
  const locations = new Set<string>();
  for (const [id, ref] of Object.entries(value.evidenceRefsById)) {
    if (!text(id) || !exact(ref, ['checkpointId', 'eventId', 'sequence', 'evidenceIndex'])
      || !text(ref.checkpointId) || !text(ref.eventId) || !integer(ref.sequence) || !integer(ref.evidenceIndex, 0)) return fail();
    const location = JSON.stringify([ref.eventId, ref.evidenceIndex]);
    if (locations.has(location)) return fail();
    locations.add(location);
  }
  for (const [id, ref] of Object.entries(value.childRefsById)) {
    if (!text(id) || !exact(ref, ['childId', 'sessionId', 'lifecycleCheckpointId']) || ref.childId !== id
      || !text(ref.sessionId) || !text(ref.lifecycleCheckpointId)) return fail();
  }
  const active = new Set(activeIds);
  for (const id of oldIds) {
    if (!text(id)) return fail();
    const seen = new Set<string>();
    let cursor = id;
    while (Object.hasOwn(value.supersededEvidenceIds, cursor)) {
      if (seen.has(cursor)) return fail();
      seen.add(cursor);
      const next = value.supersededEvidenceIds[cursor];
      if (!text(next)) return fail();
      cursor = next;
    }
    if (!active.has(cursor)) return fail();
  }
  return value as unknown as GoalEvidenceInventoryV1;
}

function validateReceipt(value: unknown, context: GoalCompletionStorageContext, inventory: GoalEvidenceInventory): GoalCompletionReceipt {
  if (!exact(value, [...scopeKeys, 'reviewedStateRevision', 'authorizedStateRevision', 'inventoryStateRevision',
    'choice', 'confidence', 'binding', 'criterionEvidenceIds']) || value.schemaVersion !== inventory.schemaVersion || value.choice !== 'complete'
    || typeof value.confidence !== 'number' || !Number.isFinite(value.confidence) || value.confidence < .95 || value.confidence > 1
    || !integer(value.reviewedStateRevision) || !integer(value.authorizedStateRevision) || !integer(value.inventoryStateRevision)
    || value.authorizedStateRevision !== context.stateRevision || value.reviewedStateRevision !== context.stateRevision - 1
    || value.inventoryStateRevision !== inventory.inventoryStateRevision || value.inventoryStateRevision > value.reviewedStateRevision) return fail();
  scope(value, context);
  const provenanceInput = inventory.schemaVersion === 2 ? {
    runId: context.runId, rootSessionId: context.rootSessionId, provenance: inventory.provenance,
  } : undefined;
  const candidate = prepareGoalCompletion(context.packet, value.criterionEvidenceIds, inventory.host, provenanceInput);
  // This assertion checks consistency only. It does NOT prove Jev or producer trust.
  assertGoalCompletion(context.packet, { binding: value.binding as GoalCompletionBinding,
    criterionEvidenceIds: value.criterionEvidenceIds as GoalCompletionCandidate['criterionEvidenceIds'] }, inventory.host,
    { ...candidate.binding, accepted: true }, provenanceInput);
  return value as unknown as GoalCompletionReceipt;
}

/** Storage integrity only. Live producer provenance and real Jev review remain external gates. */
export function validateGoalCompletionState(context: GoalCompletionStorageContext, rawInventory: unknown, rawReceipt: unknown): GoalCompletionStoredState {
  try {
    if (!text(context.runId) || !text(context.rootSessionId) || !integer(context.stateRevision)) return fail();
    const inventoryJson = jsonClone(rawInventory);
    const receiptJson = jsonClone(rawReceipt);
    if (inventoryJson === null) {
      if (receiptJson !== null) return fail();
      return { evidenceInventory: null, completionAuthorization: null };
    }
    const evidenceInventory = validateInventory(inventoryJson, context);
    if (receiptJson === null && evidenceInventory.inventoryStateRevision !== context.stateRevision) return fail();
    const completionAuthorization = receiptJson === null ? null : validateReceipt(receiptJson, context, evidenceInventory);
    return { evidenceInventory, completionAuthorization };
  } catch { return fail(); }
}
