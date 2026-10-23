import { createHash } from 'node:crypto';
import type { ArchitectureGoalDecisionBindingV1, ArchitectureGoalPacketV1, WorkflowEvidence, WorkflowEvidenceKind, WorkflowEvidenceStatus } from '@kalio/types';
import { assertGoalProjectionHistory } from './architecture-goal-projection';
import { validateGoalCompletionProvenance, type GoalCompletionProvenanceContext, type GoalCompletionProvenanceV2 } from './architecture-goal-provenance';

/** Caller MUST supply the authoritative CURRENT RUN / CURRENT GOAL VERSION inventory,
 * never a global audit inventory. Host owns recovery supersession/latest selection:
 * this guard does not infer authority or recovery from timestamps or evidence.data.
 * CLI status must be normalized by host from real lifecycle evidence, never prose. */
export interface GoalCompletionHostEvidence {
  evidenceById: Readonly<Record<string, WorkflowEvidence>>;
  cliChildrenById: Readonly<Record<string, WorkflowEvidenceStatus>>;
}
export type GoalCompletionBinding = ArchitectureGoalDecisionBindingV1 & { sourceFingerprint: string };
export interface GoalCompletionCandidate {
  binding: GoalCompletionBinding;
  criterionEvidenceIds: Readonly<Record<string, readonly string[]>>;
}
export interface GoalCompletionInspection extends GoalCompletionCandidate {
  activeCriterionIds: readonly string[];
  eligible: boolean;
}
export type GoalCompletionCallerBinding = GoalCompletionBinding & { accepted: true };
/** Explicit host-owned run/root scope, never inferred from canonical source session.
 * Structural validation is NOT producer trust, durable reference proof or approval. */
export type GoalCompletionProvenanceInput = Pick<GoalCompletionProvenanceContext, 'runId' | 'rootSessionId'> & {
  provenance: unknown;
};

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
const KINDS = ['BUILD_RESULT', 'GIT_STATUS', 'FINAL_ARTIFACT', 'QUALITY_GATE', 'TOOL_RESULT', 'CLI_CHILD', 'VFS_WRITE', 'VFS_READ'] as const satisfies readonly WorkflowEvidenceKind[];
const STATUSES = ['passed', 'failed', 'blocked', 'unknown'] as const satisfies readonly WorkflowEvidenceStatus[];
const BINDING_KEYS = ['goalVersion', 'goalFingerprint', 'sourceFingerprint', 'evidenceFingerprint', 'policyFingerprint'] as const;
function fail(): never { throw new Error('Invalid goal completion.'); }
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}
function exact(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return record(value) && Reflect.ownKeys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
function text(value: unknown): value is string { return typeof value === 'string' && value.trim().length > 0; }
function kind(value: unknown): value is WorkflowEvidenceKind { return KINDS.some(item => item === value); }
function status(value: unknown): value is WorkflowEvidenceStatus { return STATUSES.some(item => item === value); }

/** Strict JSON only: no coercion, toJSON, getters, symbols, holes or silent omissions. */
function canonical(value: unknown, ancestors = new Set<object>()): Json {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : fail();
  if (typeof value !== 'object' || ancestors.has(value)) return fail();
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      if (Reflect.ownKeys(value).length !== value.length + 1) return fail();
      return Array.from({ length: value.length }, (_, i) => {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
        return descriptor && 'value' in descriptor && descriptor.enumerable ? canonical(descriptor.value, ancestors) : fail();
      });
    }
    if (!record(value) || Reflect.ownKeys(value).some(key => typeof key !== 'string')
      || Reflect.ownKeys(value).length !== Object.keys(value).length) return fail();
    return Object.fromEntries(Object.keys(value).sort().map(key => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) return fail();
      return [key, canonical(descriptor.value, ancestors)];
    }));
  } finally { ancestors.delete(value); }
}
function hash(value: unknown): string { return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex'); }

function inventory(raw: GoalCompletionHostEvidence): GoalCompletionHostEvidence {
  canonical(raw);
  if (!exact(raw, ['evidenceById', 'cliChildrenById']) || !record(raw.evidenceById) || !record(raw.cliChildrenById)) return fail();
  const evidenceById = Object.fromEntries(Object.keys(raw.evidenceById).sort().map(id => {
    const evidence = raw.evidenceById[id];
    if (!text(id) || !record(evidence) || !Object.hasOwn(evidence, 'kind') || !Object.hasOwn(evidence, 'status')
      || Object.keys(evidence).some(key => !['kind', 'status', 'source', 'data'].includes(key))
      || !kind(evidence.kind) || !status(evidence.status)) return fail();
    const row: WorkflowEvidence = { kind: evidence.kind, status: evidence.status };
    if (Object.hasOwn(evidence, 'source')) { if (!text(evidence.source)) return fail(); row.source = evidence.source; }
    if (Object.hasOwn(evidence, 'data')) {
      if (!record(evidence.data)) return fail();
      const data = canonical(evidence.data);
      if (!record(data)) return fail();
      row.data = data;
    }
    return [id, row];
  }));
  const cliChildrenById = Object.fromEntries(Object.keys(raw.cliChildrenById).sort().map(id => {
    const state = raw.cliChildrenById[id];
    if (!text(id) || !status(state)) return fail();
    return [id, state];
  }));
  return { evidenceById, cliChildrenById };
}

function inspect(packet: ArchitectureGoalPacketV1, rawRefs: unknown, host: GoalCompletionHostEvidence,
  provenanceInput?: GoalCompletionProvenanceInput): GoalCompletionInspection {
  assertGoalProjectionHistory(packet);
  if (packet.projection.status !== 'accepted') return fail();
  const snapshot = packet.projection.snapshot;
  const superseded = new Set(snapshot.criteria.flatMap(row => row.supersedes));
  const activeIds = snapshot.criteria.filter(row => !superseded.has(row.id)).map(row => row.id).sort();
  if (!activeIds.length) return fail();
  canonical(packet.completionPolicy); canonical(rawRefs);
  if (!exact(packet.completionPolicy, ['requiredEvidenceKindsByCriterion'])
    || !exact(packet.completionPolicy.requiredEvidenceKindsByCriterion, activeIds) || !exact(rawRefs, activeIds)) return fail();
  const inventoryRows = inventory(host);
  let provenance: GoalCompletionProvenanceV2 | undefined;
  if (provenanceInput !== undefined) {
    canonical(provenanceInput);
    if (!exact(provenanceInput, ['runId', 'rootSessionId', 'provenance']) || !text(provenanceInput.runId) || !text(provenanceInput.rootSessionId)) return fail();
    provenance = validateGoalCompletionProvenance({ runId: provenanceInput.runId,
      rootSessionId: provenanceInput.rootSessionId, packet, host: inventoryRows }, provenanceInput.provenance);
  }
  const policyEntries: [string, WorkflowEvidenceKind[]][] = [];
  const refEntries: [string, string[]][] = [];
  let eligible = Object.values(inventoryRows.cliChildrenById).every(state => state === 'passed')
    && Object.values(inventoryRows.evidenceById).every(row => row.kind !== 'CLI_CHILD' || row.status === 'passed')
    && (provenance === undefined || provenance.checkpoint.status === 'sealed');
  for (const id of activeIds) {
    const required = packet.completionPolicy.requiredEvidenceKindsByCriterion[id];
    const refs = rawRefs[id];
    if (!Array.isArray(required) || !required.length || !required.every(kind) || new Set(required).size !== required.length
      || !Array.isArray(refs) || !refs.every(text) || new Set(refs).size !== refs.length) return fail();
    const evidence = refs.map(ref => Object.hasOwn(inventoryRows.evidenceById, ref) ? inventoryRows.evidenceById[ref]! : fail());
    if (!refs.length || evidence.some(row => row.status !== 'passed') || required.some(k => !evidence.some(row => row.kind === k))) eligible = false;
    // All entries are host-selected authoritative current results; no timestamp guessing.
    if (required.includes('BUILD_RESULT') && Object.values(inventoryRows.evidenceById).some(row => row.kind === 'BUILD_RESULT' && row.status !== 'passed')) eligible = false;
    policyEntries.push([id, [...required].sort()]); refEntries.push([id, [...refs].sort()]);
  }
  const criterionEvidenceIds = Object.fromEntries(refEntries);
  return { binding: {
    goalVersion: packet.version, sourceFingerprint: packet.sourceFingerprint, goalFingerprint: snapshot.goalFingerprint,
    evidenceFingerprint: hash({ ...inventoryRows, criterionEvidenceIds, ...(provenance === undefined ? {} : { provenance }) }),
    policyFingerprint: hash({ requiredEvidenceKindsByCriterion: Object.fromEntries(policyEntries),
      ...(provenance === undefined ? {} : { buildExpectation: provenance.buildExpectation }) }),
  }, criterionEvidenceIds, activeCriterionIds: activeIds, eligible };
}

/** Bound current-state inspection, NOT semantic acceptance. Valid incomplete inventory
 * remains reviewable for continue choices; structural invalidity is never downgraded. */
export function inspectGoalCompletion(packet: ArchitectureGoalPacketV1, criterionEvidenceIds: unknown,
  host: GoalCompletionHostEvidence, provenanceInput?: GoalCompletionProvenanceInput): GoalCompletionInspection {
  try { return inspect(packet, criterionEvidenceIds, host, provenanceInput); } catch { return fail(); }
}

function prepare(packet: ArchitectureGoalPacketV1, criterionEvidenceIds: unknown, host: GoalCompletionHostEvidence,
  provenanceInput?: GoalCompletionProvenanceInput): GoalCompletionCandidate {
  const inspected = inspect(packet, criterionEvidenceIds, host, provenanceInput);
  if (!inspected.eligible) return fail();
  return { binding: inspected.binding, criterionEvidenceIds: inspected.criterionEvidenceIds };
}

/** Eligibility candidate only, NOT semantic Jev acceptance or persisted completion. */
export function prepareGoalCompletion(packet: ArchitectureGoalPacketV1, criterionEvidenceIds: unknown,
  host: GoalCompletionHostEvidence, provenanceInput?: GoalCompletionProvenanceInput): GoalCompletionCandidate {
  try { return prepare(packet, criterionEvidenceIds, host, provenanceInput); } catch { return fail(); }
}

/** accepted:true is only the authorized caller's assertion, NOT authorization/proof.
 * Caller must produce it after valid semantic review and persist atomically with CAS. */
export function assertGoalCompletion(packet: ArchitectureGoalPacketV1, candidate: GoalCompletionCandidate,
  host: GoalCompletionHostEvidence, callerBinding: GoalCompletionCallerBinding,
  provenanceInput?: GoalCompletionProvenanceInput): void {
  try {
    canonical(callerBinding);
    if (!exact(candidate, ['binding', 'criterionEvidenceIds']) || !exact(candidate.binding, BINDING_KEYS)
      || !exact(callerBinding, [...BINDING_KEYS, 'accepted']) || callerBinding.accepted !== true) return fail();
    const current = prepare(packet, candidate.criterionEvidenceIds, host, provenanceInput);
    if (JSON.stringify(canonical(candidate)) !== JSON.stringify(canonical(current))
      || BINDING_KEYS.some(key => callerBinding[key] !== candidate.binding[key])) return fail();
  } catch { return fail(); }
}
