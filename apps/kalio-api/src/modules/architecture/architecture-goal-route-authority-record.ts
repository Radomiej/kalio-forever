import { types } from 'node:util';
import type { ArchitectureRun, ArchitectureSchema } from '@kalio/types';
import type { AuditGoalProofLocator } from '../chat/audit.service';
import type { GoalPhaseBinding } from './architecture-graph-goal-nodes';
import { cloneGoalCompletionJson } from './architecture-goal-completion-state';
import { goalRouteAuditData } from './architecture-goal-route-audit';

export type GoalRouteProofRef = Required<Pick<AuditGoalProofLocator, 'id' | 'label' | 'expectedDataSha256'>>;
interface GoalRouteAuthorityBaseV1 {
  schemaVersion: 1; goalProtocol: true; runId: string; rootSessionId: string; schemaId: string;
  sequence: number; binding: GoalPhaseBinding;
}
interface GoalRouteVisitIdentity { nodeId: string; visit: number; branchSessionId: string | null; }
export type GoalRouteAdmissionV1 = GoalRouteAuthorityBaseV1 & GoalRouteVisitIdentity & {
  recordType: 'goal_route_admission'; authorizationRef: GoalRouteProofRef;
} & ({ admissionKind: 'launch'; predecessorAdmissionRef: null; stopRef: null; entryRouteRef: null }
  | { admissionKind: 'readmission'; predecessorAdmissionRef: GoalRouteProofRef;
    stopRef: GoalRouteProofRef | null; entryRouteRef: GoalRouteProofRef });
export type GoalRouteVisitV1 = GoalRouteAuthorityBaseV1 & GoalRouteVisitIdentity & {
  recordType: 'goal_route_visit'; admissionRef: GoalRouteProofRef; eventId: string;
} & ({ transition: 'started'; predecessorVisitRef: GoalRouteProofRef | null; startedRef: null; routeRef: null }
  | { transition: 'completed'; predecessorVisitRef: GoalRouteProofRef; startedRef: GoalRouteProofRef; routeRef: GoalRouteProofRef });
export type GoalRouteAuthorityRecordV1 = GoalRouteAdmissionV1 | GoalRouteVisitV1;
export interface GoalRouteAuthorityLeafV1 { proof: GoalRouteProofRef; record: GoalRouteAuthorityRecordV1; }
export interface GoalRouteAuthorityContext {
  run: Pick<ArchitectureRun, 'id' | 'rootSessionId' | 'schemaId' | 'branchSessionIds'>;
  schema: ArchitectureSchema;
}

function fail(): never { throw new Error('GOAL_ROUTE_AUTHORITY_RECORD_INVALID'); }
function text(value: unknown): value is string { return typeof value === 'string' && !!value.trim(); }
function positive(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value > 0; }
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function exact(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return object(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
// Reject proxies before reflection: descriptor inspection itself can otherwise execute traps.
function noCapabilities(value: unknown, parents = new Set<object>()): void {
  if (value === null || typeof value !== 'object') return;
  if (types.isProxy(value) || parents.has(value) || parents.size >= 100) return fail();
  parents.add(value);
  try {
    for (const key of Reflect.ownKeys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !('value' in descriptor)) return fail();
      noCapabilities(descriptor.value, parents);
    }
  } finally { parents.delete(value); }
}
function detached<T>(value: T): T { noCapabilities(value); return cloneGoalCompletionJson(value); }
function proof(value: unknown): GoalRouteProofRef {
  if (!exact(value, ['id', 'label', 'expectedDataSha256']) || !text(value.id) || !text(value.label)
    || typeof value.expectedDataSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.expectedDataSha256)) return fail();
  return { id: value.id, label: value.label, expectedDataSha256: value.expectedDataSha256 };
}
function same(a: GoalRouteProofRef, b: GoalRouteProofRef): boolean {
  return a.id === b.id && a.label === b.label && a.expectedDataSha256 === b.expectedDataSha256;
}
const baseKeys = ['schemaVersion', 'goalProtocol', 'runId', 'rootSessionId', 'schemaId', 'sequence', 'binding', 'nodeId', 'visit', 'branchSessionId'];
function decode(raw: unknown, context: GoalRouteAuthorityContext): GoalRouteAuthorityRecordV1 {
  if (!object(raw) || !text(context.run.id) || !text(context.run.rootSessionId)
    || !text(context.run.schemaId) || context.schema.id !== context.run.schemaId
    || raw.schemaVersion !== 1 || raw.goalProtocol !== true || raw.runId !== context.run.id
    || raw.rootSessionId !== context.run.rootSessionId || raw.schemaId !== context.run.schemaId
    || !positive(raw.sequence) || !positive(raw.visit) || !text(raw.nodeId)) return fail();
  const nodes = context.schema.nodes.filter(node => node.id === raw.nodeId);
  if (nodes.length !== 1) return fail();
  const node = nodes[0]!;
  if (node.roleSlotId) {
    const branches = context.run.branchSessionIds;
    if (context.schema.roleSlots.filter(slot => slot.id === node.roleSlotId).length !== 1
      || !text(raw.branchSessionId) || !branches || !Object.hasOwn(branches, node.roleSlotId)
      || branches[node.roleSlotId] !== raw.branchSessionId) return fail();
  } else if (node.kind !== 'artifact' || raw.branchSessionId !== null) return fail();
  const validated = goalRouteAuditData({ goalBinding: raw.binding }).goalBinding;
  // The existing validator checks every field; this assertion introduces no domain schema.
  const binding = validated as GoalPhaseBinding;
  const base: GoalRouteAuthorityBaseV1 & GoalRouteVisitIdentity = {
    schemaVersion: 1, goalProtocol: true, runId: context.run.id, rootSessionId: context.run.rootSessionId,
    schemaId: context.run.schemaId, sequence: raw.sequence, binding, nodeId: raw.nodeId,
    visit: raw.visit, branchSessionId: raw.branchSessionId as string | null,
  };
  if (raw.recordType === 'goal_route_admission') {
    if (!exact(raw, [...baseKeys, 'recordType', 'admissionKind', 'authorizationRef', 'predecessorAdmissionRef', 'stopRef', 'entryRouteRef'])) return fail();
    const authorizationRef = proof(raw.authorizationRef);
    if (raw.admissionKind === 'launch') {
      if (raw.predecessorAdmissionRef !== null || raw.stopRef !== null || raw.entryRouteRef !== null) return fail();
      return { ...base, recordType: 'goal_route_admission', admissionKind: 'launch', authorizationRef,
        predecessorAdmissionRef: null, stopRef: null, entryRouteRef: null };
    }
    if (raw.admissionKind !== 'readmission') return fail();
    return { ...base, recordType: 'goal_route_admission', admissionKind: 'readmission', authorizationRef,
      predecessorAdmissionRef: proof(raw.predecessorAdmissionRef), stopRef: raw.stopRef === null ? null : proof(raw.stopRef),
      entryRouteRef: proof(raw.entryRouteRef) };
  }
  if (raw.recordType !== 'goal_route_visit' || !exact(raw, [...baseKeys, 'recordType', 'transition', 'admissionRef', 'eventId',
    'predecessorVisitRef', 'startedRef', 'routeRef']) || !text(raw.eventId)) return fail();
  const admissionRef = proof(raw.admissionRef);
  if (raw.transition === 'started') {
    if (raw.startedRef !== null || raw.routeRef !== null) return fail();
    return { ...base, recordType: 'goal_route_visit', transition: 'started', admissionRef, eventId: raw.eventId,
      predecessorVisitRef: raw.predecessorVisitRef === null ? null : proof(raw.predecessorVisitRef), startedRef: null, routeRef: null };
  }
  if (raw.transition !== 'completed') return fail();
  const predecessorVisitRef = proof(raw.predecessorVisitRef); const startedRef = proof(raw.startedRef);
  if (!same(predecessorVisitRef, startedRef)) return fail();
  return { ...base, recordType: 'goal_route_visit', transition: 'completed', admissionRef, eventId: raw.eventId,
    predecessorVisitRef, startedRef, routeRef: proof(raw.routeRef) };
}

/** Structure only. A standalone started row cannot establish launch-entry ancestry.
 * External refs require exact scoped audit reads and dispatcher-owned authorization.
 * V1 readmission permits zero/one intervening Stop; the reader must reject multiple
 * distinct Stops, never silently select the latest. ACK retries reuse the same Stop. */
export function decodeGoalRouteAuthorityRecord(raw: unknown, context: GoalRouteAuthorityContext): GoalRouteAuthorityRecordV1 {
  try { return decode(detached(raw), detached(context)); } catch { return fail(); }
}

/** Complete admission/visit closure, not an executable resume or proof of ACK.
 * No external authorization/Stop/route record is resolved by this pure decoder. */
export function decodeGoalRouteAuthorityRecords(raw: unknown, context: GoalRouteAuthorityContext): readonly GoalRouteAuthorityLeafV1[] {
  try {
    const input = detached(raw); const scope = detached(context);
    if (!Array.isArray(input) || input.length === 0 || input.length > 5000) return fail();
    const leaves = input.map(value => {
      if (!exact(value, ['proof', 'record'])) return fail();
      const leaf = { proof: proof(value.proof), record: decode(value.record, scope) };
      if (leaf.proof.label !== `architecture_event:${leaf.record.recordType}`) return fail();
      return leaf;
    });
    const byId = new Map(leaves.map(leaf => [leaf.proof.id, leaf]));
    if (byId.size !== leaves.length || new Set(leaves.map(leaf => leaf.record.sequence)).size !== leaves.length) return fail();
    const visits = leaves.flatMap(leaf => leaf.record.recordType === 'goal_route_visit' ? [leaf.record] : []);
    if (new Set(visits.map(row => row.eventId)).size !== visits.length
      || leaves.filter(leaf => leaf.record.recordType === 'goal_route_admission' && leaf.record.admissionKind === 'launch').length !== 1) return fail();
    const usedPredecessors = new Set<string>(); const entries = new Set<string>();
    function earlier(ref: GoalRouteProofRef, current: GoalRouteAuthorityRecordV1): GoalRouteAuthorityRecordV1 {
      const target = byId.get(ref.id);
      if (!target || !same(ref, target.proof) || target.record.sequence >= current.sequence) return fail();
      return target.record; // Strictly decreasing sequence makes cycles impossible.
    }
    for (const { record: row } of leaves) {
      if (row.recordType === 'goal_route_admission') {
        if (row.admissionKind === 'readmission' && earlier(row.predecessorAdmissionRef, row).recordType !== 'goal_route_admission') return fail();
        continue;
      }
      const admission = earlier(row.admissionRef, row);
      if (admission.recordType !== 'goal_route_admission') return fail();
      if (row.predecessorVisitRef === null) {
        if (admission.admissionKind !== 'launch' || row.nodeId !== admission.nodeId || row.visit !== admission.visit
          || row.branchSessionId !== admission.branchSessionId || entries.has(row.admissionRef.id)) return fail();
        entries.add(row.admissionRef.id);
        continue;
      }
      const predecessor = earlier(row.predecessorVisitRef, row);
      if (predecessor.recordType !== 'goal_route_visit') return fail();
      if (usedPredecessors.has(row.predecessorVisitRef.id)) return fail();
      usedPredecessors.add(row.predecessorVisitRef.id);
      if (row.transition === 'completed') {
        if (predecessor.transition !== 'started' || !same(predecessor.admissionRef, row.admissionRef)
          || predecessor.nodeId !== row.nodeId || predecessor.visit !== row.visit || predecessor.branchSessionId !== row.branchSessionId
          || predecessor.binding.sourceVersion !== row.binding.sourceVersion
          || predecessor.binding.sourceFingerprint !== row.binding.sourceFingerprint
          || predecessor.binding.stateRevision > row.binding.stateRevision) return fail();
      } else if (predecessor.transition === 'started') {
        if (admission.admissionKind !== 'readmission' || same(predecessor.admissionRef, row.admissionRef)
          || predecessor.nodeId !== row.nodeId || predecessor.visit !== row.visit || predecessor.branchSessionId !== row.branchSessionId
          || row.nodeId !== admission.nodeId || row.visit !== admission.visit || row.branchSessionId !== admission.branchSessionId) return fail();
      } else if (predecessor.nodeId === row.nodeId && row.visit !== predecessor.visit + 1) {
        return fail();
      }
    }
    return leaves;
  } catch { return fail(); }
}
