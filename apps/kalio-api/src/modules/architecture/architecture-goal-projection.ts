import { createHash } from 'node:crypto';
import type {
  ArchitectureGoalCompletionPolicyV1, ArchitectureGoalCriterionProposalV1, ArchitectureGoalCriterionV1,
  ArchitectureGoalPacketV1, ArchitectureGoalProjectionProposalV1, ArchitectureGoalSourceQuoteV1,
  WorkflowEvidenceKind,
} from '@kalio/types';
import { appendGoalSource, createGoalPacket } from './architecture-goal-source';

/** Caller assertion, NOT authorization or proof. Create only after the authorized
 * host Jev review service validates a semantic review response for this proposal. */
export interface GoalProjectionReviewBinding {
  sourceVersion: number;
  sourceFingerprint: string;
  proposalFingerprint: string;
  accepted: boolean;
}

const EVIDENCE_KINDS = ['BUILD_RESULT', 'GIT_STATUS', 'FINAL_ARTIFACT', 'QUALITY_GATE',
  'TOOL_RESULT', 'CLI_CHILD', 'VFS_WRITE', 'VFS_READ'] as const satisfies readonly WorkflowEvidenceKind[];
const PROPOSAL_ERROR = 'Invalid goal proposal.';
const ACCEPTANCE_ERROR = 'Invalid goal acceptance.';

function fail(message = PROPOSAL_ERROR): never { throw new Error(message); }
function hash(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}
function exact(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return record(value) && Reflect.ownKeys(value).length === keys.length
    && keys.every((key) => Object.hasOwn(value, key));
}
function text(value: unknown): value is string { return typeof value === 'string' && value.trim().length > 0; }
function compare(a: string, b: string): number { return a < b ? -1 : a > b ? 1 : 0; }
function canonical(row: ArchitectureGoalCriterionProposalV1): ArchitectureGoalCriterionProposalV1 {
  return { text: row.text, sourceQuotes: row.sourceQuotes.map((q) => ({ messageId: q.messageId, quote: q.quote }))
    .sort((a, b) => compare(JSON.stringify(a), JSON.stringify(b))), supersedes: [...row.supersedes].sort(compare) };
}

function pending(packet: ArchitectureGoalPacketV1): ArchitectureGoalPacketV1 & {
  projection: Extract<ArchitectureGoalPacketV1['projection'], { status: 'pending' }>;
} {
  let validated: ArchitectureGoalPacketV1;
  try { validated = appendGoalSource(packet, packet.original); } catch { return fail(); }
  if (validated.projection.status !== 'pending') return fail();
  const base = validated.projection.base;
  if (base && (base.sourceVersion >= validated.version || !Array.isArray(base.criteria))) return fail();
  // Keep source validation owned by architecture-goal-source; no duplicate source hashing.
  return { ...validated, projection: validated.projection };
}

function parseCriterion(raw: unknown, packet: ArchitectureGoalPacketV1): ArchitectureGoalCriterionProposalV1 {
  if (!exact(raw, ['text', 'sourceQuotes', 'supersedes']) || !text(raw.text)
    || !Array.isArray(raw.sourceQuotes) || !raw.sourceQuotes.length || !Array.isArray(raw.supersedes)) return fail();
  const sources = [packet.original, ...packet.updates];
  const sourceQuotes: ArchitectureGoalSourceQuoteV1[] = raw.sourceQuotes.map((entry: unknown) => {
    if (!exact(entry, ['messageId', 'quote']) || !text(entry.messageId) || !text(entry.quote)) return fail();
    const source = sources.find((item) => item.messageId === entry.messageId);
    if (!source || !source.content.includes(entry.quote)) return fail();
    return { messageId: entry.messageId, quote: entry.quote };
  });
  const supersedes = raw.supersedes.map((value: unknown) => text(value) ? value : fail());
  if (new Set(sourceQuotes.map((quote) => JSON.stringify(quote))).size !== sourceQuotes.length
    || new Set(supersedes).size !== supersedes.length) return fail();
  return canonical({ text: raw.text, sourceQuotes, supersedes });
}

function history(packet: ArchitectureGoalPacketV1): ArchitectureGoalCriterionV1[] {
  const base = packet.projection.status === 'accepted' ? packet.projection.snapshot : packet.projection.base;
  if (!base) return [];
  if (!exact(base, ['sourceVersion', 'criteria', 'goalFingerprint']) || !Array.isArray(base.criteria) || !base.criteria.length) return fail();
  let prefix = createGoalPacket(packet.original);
  for (const source of packet.updates.slice(0, base.sourceVersion - 1)) prefix = appendGoalSource(prefix, source);
  const seen = new Set<string>();
  const rows = base.criteria.map((raw: unknown) => {
    if (!exact(raw, ['id', 'text', 'sourceQuotes', 'supersedes']) || !text(raw.id)) return fail();
    const row = parseCriterion({ text: raw.text, sourceQuotes: raw.sourceQuotes, supersedes: raw.supersedes }, prefix);
    // Array order is acceptance order: supersession can only point backwards.
    if (raw.id !== criterionId(row) || seen.has(raw.id) || row.supersedes.some((id) => !seen.has(id))) return fail();
    seen.add(raw.id);
    return { id: raw.id, ...row };
  });
  if (base.goalFingerprint !== goalFingerprint(prefix, rows)) return fail();
  return rows;
}

function criterionId(row: ArchitectureGoalCriterionProposalV1): string { return `c-${hash(canonical(row))}`; }
function goalFingerprint(packet: ArchitectureGoalPacketV1, rows: readonly ArchitectureGoalCriterionV1[]): string {
  return hash({ sourceVersion: packet.version, sourceFingerprint: packet.sourceFingerprint, criteria: rows });
}

/** Persisted snapshot integrity only, NOT proof of authorized semantic review. */
export function assertGoalProjectionHistory(packet: ArchitectureGoalPacketV1): void {
  try { history(appendGoalSource(packet, packet.original)); } catch { return fail(); }
}

/** Structural provenance and source coverage only; NOT semantic completeness. */
export function prepareGoalProjection(packet: ArchitectureGoalPacketV1, raw: unknown): ArchitectureGoalProjectionProposalV1 {
  try { return prepare(packet, raw); } catch { return fail(); }
}

function prepare(packet: ArchitectureGoalPacketV1, raw: unknown): ArchitectureGoalProjectionProposalV1 {
  const current = pending(packet);
  if (!exact(raw, ['sourceVersion', 'criteria']) || raw.sourceVersion !== current.version
    || !Array.isArray(raw.criteria) || raw.criteria.length === 0 || raw.criteria.length > 32) return fail();
  const old = history(current);
  const oldIds = new Set(old.map((row) => row.id));
  const newerSourceIds = new Set(current.updates.slice((current.projection.base?.sourceVersion ?? 1) - 1).map((source) => source.messageId));
  const targeted = new Set<string>();
  const criteria = raw.criteria.map((entry: unknown) => {
    const row = parseCriterion(entry, current);
    if (row.supersedes.some((id) => !oldIds.has(id) || targeted.has(id))) return fail();
    if (row.supersedes.length && !row.sourceQuotes.some((q) => newerSourceIds.has(q.messageId))) return fail();
    row.supersedes.forEach((id) => targeted.add(id));
    return row;
  }).sort((a, b) => compare(JSON.stringify(a), JSON.stringify(b)));
  if (new Set(criteria.map((row) => JSON.stringify(row))).size !== criteria.length) return fail();
  const covered = new Set(criteria.flatMap((row) => row.sourceQuotes.map((q) => q.messageId)));
  if ([current.original, ...current.updates].some((source) => !covered.has(source.messageId))) return fail();
  return { sourceVersion: current.version, criteria, proposalFingerprint: hash({
    sourceVersion: current.version, sourceFingerprint: current.sourceFingerprint, criteria,
  }) };
}

function verifiedProposal(packet: ArchitectureGoalPacketV1, prepared: ArchitectureGoalProjectionProposalV1): ArchitectureGoalProjectionProposalV1 {
  if (!exact(prepared, ['sourceVersion', 'criteria', 'proposalFingerprint']) || !text(prepared.proposalFingerprint)) return fail();
  const calculated = prepareGoalProjection(packet, { sourceVersion: prepared.sourceVersion, criteria: prepared.criteria });
  if (calculated.proposalFingerprint !== prepared.proposalFingerprint) return fail();
  return calculated;
}

function candidate(packet: ArchitectureGoalPacketV1, prepared: ArchitectureGoalProjectionProposalV1) {
  const current = pending(packet);
  const proposal = verifiedProposal(current, prepared);
  const rows = history(current);
  const ids = new Map(rows.map((row) => [row.id, row]));
  for (const criterion of proposal.criteria) {
    const id = criterionId(criterion);
    const existing = ids.get(id);
    if (criterion.supersedes.includes(id) || (existing && JSON.stringify(canonical(existing)) !== JSON.stringify(criterion))) return fail();
    if (!existing) { const row = { id, ...criterion }; rows.push(row); ids.set(id, row); }
  }
  const superseded = new Set(rows.flatMap((row) => row.supersedes));
  const active = rows.filter((row) => !superseded.has(row.id));
  if (!active.length) return fail();
  return { current, proposal, rows, active };
}

/** Host classification targets, NOT accepted truth. Uses the same IDs as acceptance. */
export function goalProjectionPolicyTargets(packet: ArchitectureGoalPacketV1, prepared: ArchitectureGoalProjectionProposalV1): readonly ArchitectureGoalCriterionV1[] {
  try { return structuredClone(candidate(packet, prepared).active); } catch { return fail(); }
}

function evidenceKind(value: unknown): value is WorkflowEvidenceKind {
  return typeof value === 'string' && EVIDENCE_KINDS.some((kind) => kind === value);
}
function policyFor(raw: unknown, active: readonly ArchitectureGoalCriterionV1[]): ArchitectureGoalCompletionPolicyV1 {
  if (!exact(raw, ['requiredEvidenceKindsByCriterion']) || !exact(raw.requiredEvidenceKindsByCriterion, active.map((row) => row.id))) return fail(ACCEPTANCE_ERROR);
  const requirements = raw.requiredEvidenceKindsByCriterion;
  const entries: [string, WorkflowEvidenceKind[]][] = active.map((row) => {
    const kinds = requirements[row.id];
    if (!Array.isArray(kinds) || !kinds.length || !kinds.every(evidenceKind) || new Set(kinds).size !== kinds.length) return fail(ACCEPTANCE_ERROR);
    return [row.id, [...kinds]];
  });
  return { requiredEvidenceKindsByCriterion: Object.fromEntries(entries) };
}

/** Pure atomic construction only. The caller must persist with its own CAS/transaction. */
export function acceptGoalProjection(packet: ArchitectureGoalPacketV1, prepared: ArchitectureGoalProjectionProposalV1,
  hostPolicy: unknown, reviewBinding: GoalProjectionReviewBinding): ArchitectureGoalPacketV1 {
  try {
    const { current, proposal, rows, active } = candidate(packet, prepared);
    const attached = current.projection.proposal;
    if (!attached || verifiedProposal(current, attached).proposalFingerprint !== proposal.proposalFingerprint
      || !exact(reviewBinding, ['sourceVersion', 'sourceFingerprint', 'proposalFingerprint', 'accepted'])
      || reviewBinding.accepted !== true || reviewBinding.sourceVersion !== current.version
      || reviewBinding.sourceFingerprint !== current.sourceFingerprint
      || reviewBinding.proposalFingerprint !== proposal.proposalFingerprint) return fail(ACCEPTANCE_ERROR);
    const completionPolicy = policyFor(hostPolicy, active);
    const fingerprint = goalFingerprint(current, rows);
    return structuredClone({ ...current, completionPolicy,
      projection: { status: 'accepted', snapshot: { sourceVersion: current.version, criteria: rows, goalFingerprint: fingerprint } } });
  } catch { return fail(ACCEPTANCE_ERROR); }
}
