import type { ArchitectureGoalPacketV1, ArchitectureGoalSourceV1, ToolCallRequest, ToolResult,
  WorkflowEvidence, WorkflowEvidenceStatus } from '@kalio/types';

export interface GoalDispatchAdmission extends Required<Pick<ToolCallRequest, 'callId' | 'sessionId' | 'turnId' | 'promptMessageId'>> {
  readonly sequence: number;
  readonly admissionCheckpointId: string;
}
export interface GoalDispatchCommit {
  readonly callId: string;
  readonly sequence: number;
  readonly commitCheckpointId: string;
  readonly resultMessageId: string;
  readonly status: ToolResult['status'];
}
export interface GoalRunJournalRef {
  readonly checkpointId: string;
  readonly eventId: string;
  readonly sequence: number;
}
export interface GoalDispatchCheckpoint {
  readonly checkpointId: string;
  readonly status: 'open' | 'sealed' | 'aborted';
  readonly admissions: readonly GoalDispatchAdmission[];
  readonly commits: readonly GoalDispatchCommit[];
  readonly completedRunJournalRef: GoalRunJournalRef | null;
}
export interface GoalEvidenceRefV2 extends GoalRunJournalRef {
  readonly evidenceIndex: number;
  readonly dispatchCallId: string;
}
export interface GoalChildRefV2 {
  readonly childId: string;
  readonly sessionId: string;
  readonly lifecycleCheckpointId: string;
  readonly launchToolCallId: string;
  readonly terminalToolCallId: string;
  readonly terminalMessageId: string;
}
export interface GoalBuildExpectation {
  readonly approvedSource: Pick<ArchitectureGoalSourceV1, 'messageId' | 'sessionId' | 'turnId'>;
  readonly executable: string;
  readonly args: readonly string[];
  readonly canonicalCwd: string;
}
export interface GoalCompletionProvenanceV2 {
  readonly schemaVersion: 2;
  readonly runId: string;
  readonly rootSessionId: string;
  readonly goalVersion: number;
  readonly sourceFingerprint: string;
  readonly goalFingerprint: string;
  readonly checkpoint: GoalDispatchCheckpoint;
  readonly evidenceRefsById: Readonly<Record<string, GoalEvidenceRefV2>>;
  readonly childRefsById: Readonly<Record<string, GoalChildRefV2>>;
  readonly supersededEvidenceIds: Readonly<Record<string, string>>;
  readonly buildExpectation: GoalBuildExpectation | null;
}
export interface GoalCompletionProvenanceContext {
  readonly runId: string;
  readonly rootSessionId: string;
  readonly packet: ArchitectureGoalPacketV1;
  readonly host: {
    readonly evidenceById: Readonly<Record<string, WorkflowEvidence>>;
    readonly cliChildrenById: Readonly<Record<string, WorkflowEvidenceStatus>>;
  };
}

function fail(): never { throw new Error('GOAL_PROVENANCE_INVALID'); }
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value) as object | null);
}
function exact(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return record(value) && Reflect.ownKeys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
function text(value: unknown): value is string { return typeof value === 'string' && value.trim().length > 0; }
function integer(value: unknown, minimum = 1): value is number { return Number.isSafeInteger(value) && typeof value === 'number' && value >= minimum; }

/** Validate descriptors BEFORE reading values; never invoke accessors/toJSON or coerce input. */
function cloneJson(value: unknown, ancestors = new Set<object>()): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : fail();
  if (typeof value !== 'object' || ancestors.has(value) || ancestors.size >= 100) return fail();
  const array = Array.isArray(value);
  if (!array && !record(value)) return fail();
  if (array && Object.getPrototypeOf(value) !== Array.prototype) return fail();
  const keys = Reflect.ownKeys(value);
  if (keys.some(key => typeof key !== 'string')) return fail();
  if (array && (keys.length !== value.length + 1 || !keys.includes('length'))) return fail();
  ancestors.add(value);
  const entries: [string, unknown][] = [];
  for (const key of keys) {
    if (array && key === 'length') continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) return fail();
    if (array && (!/^(0|[1-9]\d*)$/.test(String(key)) || Number(key) >= value.length)) return fail();
    entries.push([String(key), cloneJson(descriptor.value, ancestors)]);
  }
  ancestors.delete(value);
  return array ? entries.sort((a, b) => Number(a[0]) - Number(b[0])).map(entry => entry[1]) : Object.fromEntries(entries);
}
function journal(value: unknown): value is GoalRunJournalRef {
  return exact(value, ['checkpointId', 'eventId', 'sequence']) && text(value.checkpointId) && text(value.eventId) && integer(value.sequence);
}
function equalKeys(recordValue: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(recordValue).length === keys.length && keys.every(key => Object.hasOwn(recordValue, key));
}

/** Structural consistency only. Host verifier must resolve every durable reference,
 * verify actual dispatch/build records and approval, and prove the producer is drained.
 * No eligibility, trust, canonical hash, persistence, or filesystem normalization here. */
export function validateGoalCompletionProvenance(context: GoalCompletionProvenanceContext, raw: unknown): GoalCompletionProvenanceV2 {
  try {
    const trusted = cloneJson(context) as GoalCompletionProvenanceContext;
    const value = cloneJson(raw);
    const { packet, host } = trusted;
    if (!text(trusted.runId) || !text(trusted.rootSessionId) || packet.projection.status !== 'accepted') return fail();
    if (!exact(value, ['schemaVersion', 'runId', 'rootSessionId', 'goalVersion', 'sourceFingerprint', 'goalFingerprint', 'checkpoint', 'evidenceRefsById', 'childRefsById', 'supersededEvidenceIds', 'buildExpectation'])
      || value.schemaVersion !== 2 || value.runId !== trusted.runId || value.rootSessionId !== trusted.rootSessionId
      || !integer(value.goalVersion) || value.goalVersion !== packet.version || value.sourceFingerprint !== packet.sourceFingerprint
      || !text(value.sourceFingerprint) || value.goalFingerprint !== packet.projection.snapshot.goalFingerprint || !text(value.goalFingerprint)) return fail();
    const checkpoint = value.checkpoint;
    if (!exact(checkpoint, ['checkpointId', 'status', 'admissions', 'commits', 'completedRunJournalRef']) || !text(checkpoint.checkpointId)
      || !['open', 'sealed', 'aborted'].includes(String(checkpoint.status)) || !Array.isArray(checkpoint.admissions) || !Array.isArray(checkpoint.commits)) return fail();
    const admissions = new Map<string, GoalDispatchAdmission>();
    const durableIds = new Set<string>([checkpoint.checkpointId]);
    for (const item of checkpoint.admissions) {
      if (!exact(item, ['callId', 'sessionId', 'turnId', 'promptMessageId', 'sequence', 'admissionCheckpointId'])
        || !['callId', 'sessionId', 'turnId', 'promptMessageId', 'admissionCheckpointId'].every(key => text(item[key]))
        || item.sequence !== admissions.size + 1 || admissions.has(item.callId as string) || durableIds.has(item.admissionCheckpointId as string)) return fail();
      admissions.set(item.callId as string, item as unknown as GoalDispatchAdmission);
      durableIds.add(item.admissionCheckpointId as string);
    }
    const commits = new Map<string, GoalDispatchCommit>();
    const resultIds = new Set<string>();
    for (const item of checkpoint.commits) {
      if (!exact(item, ['callId', 'sequence', 'commitCheckpointId', 'resultMessageId', 'status'])
        || !text(item.callId) || !text(item.commitCheckpointId) || !text(item.resultMessageId)
        || !['success', 'error', 'cancelled'].includes(String(item.status)) || commits.has(item.callId)
        || admissions.get(item.callId)?.sequence !== item.sequence || durableIds.has(item.commitCheckpointId) || resultIds.has(item.resultMessageId)) return fail();
      commits.set(item.callId, item as unknown as GoalDispatchCommit);
      durableIds.add(item.commitCheckpointId); resultIds.add(item.resultMessageId);
    }
    if (checkpoint.status === 'sealed') {
      if (commits.size !== admissions.size || !journal(checkpoint.completedRunJournalRef)
        || durableIds.has(checkpoint.completedRunJournalRef.checkpointId)) return fail();
    } else if (checkpoint.completedRunJournalRef !== null) return fail();
    if (!record(host.evidenceById) || !record(host.cliChildrenById) || !record(value.evidenceRefsById)
      || !record(value.childRefsById) || !record(value.supersededEvidenceIds)) return fail();
    const activeIds = Object.keys(host.evidenceById);
    const oldIds = Object.keys(value.supersededEvidenceIds);
    if (oldIds.some(id => !text(id) || activeIds.includes(id)) || !equalKeys(value.evidenceRefsById, [...activeIds, ...oldIds])) return fail();
    for (const start of oldIds) {
      const seen = new Set<string>(); let current = start;
      while (!activeIds.includes(current)) {
        if (seen.has(current) || !text(value.supersededEvidenceIds[current])) return fail();
        seen.add(current); current = value.supersededEvidenceIds[current] as string;
      }
    }
    const positions = new Set<string>();
    for (const [id, ref] of Object.entries(value.evidenceRefsById)) {
      if (!text(id) || !exact(ref, ['checkpointId', 'eventId', 'sequence', 'evidenceIndex', 'dispatchCallId'])
        || !text(ref.checkpointId) || !text(ref.eventId) || !integer(ref.sequence) || !integer(ref.evidenceIndex, 0) || !text(ref.dispatchCallId)
        || commits.get(ref.dispatchCallId)?.commitCheckpointId !== ref.checkpointId) return fail();
      const position = JSON.stringify([ref.eventId, ref.evidenceIndex]);
      if (positions.has(position)) return fail(); positions.add(position);
    }
    if (!equalKeys(value.childRefsById, Object.keys(host.cliChildrenById))) return fail();
    for (const [id, ref] of Object.entries(value.childRefsById)) {
      if (!text(id) || !exact(ref, ['childId', 'sessionId', 'lifecycleCheckpointId', 'launchToolCallId', 'terminalToolCallId', 'terminalMessageId'])
        || ref.childId !== id || !Object.values(ref).every(text) || !commits.has(ref.launchToolCallId as string)
        || !commits.has(ref.terminalToolCallId as string)) return fail();
    }
    const build = value.buildExpectation;
    const requiresBuild = Object.values(packet.completionPolicy.requiredEvidenceKindsByCriterion).some(kinds => kinds.includes('BUILD_RESULT'));
    if (requiresBuild && build === null) return fail();
    if (build !== null) {
      if (!exact(build, ['approvedSource', 'executable', 'args', 'canonicalCwd']) || !text(build.executable) || !text(build.canonicalCwd)
        || !Array.isArray(build.args) || !build.args.every(arg => typeof arg === 'string')
        || !exact(build.approvedSource, ['messageId', 'sessionId', 'turnId'])) return fail();
      const source = build.approvedSource;
      if (![packet.original, ...packet.updates].some(item => item.messageId === source.messageId && item.sessionId === source.sessionId && item.turnId === source.turnId)) return fail();
    }
    return value as unknown as GoalCompletionProvenanceV2;
  } catch { return fail(); }
}
