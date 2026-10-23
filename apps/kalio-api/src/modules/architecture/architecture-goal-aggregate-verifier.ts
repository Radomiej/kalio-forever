import type { ArchitectureGoalPacketV1, ChatTerminalJournalEvidenceReaderPort, CompletedChatRunRecord,
  HostDispatchApproval, HostHitlExecutionCommit, HostRuntimeReceiptIdentity, TerminalChatRunRecord,
  ToolResult, WorkflowEvidence, WorkflowEvidenceStatus } from '@kalio/types';
import type { ArchitectureGoalRepository, ArchitectureGoalState } from './architecture-goal.repository';
import { cloneGoalCompletionJson, validateGoalCompletionState } from './architecture-goal-completion-state';
import { inspectGoalCompletion } from './architecture-goal-completion';
import type { ArchitectureGoalSourceReadPort } from './architecture-goal-lifecycle.service';
import type { GoalBuildExpectation, GoalChildRefV2, GoalEvidenceRefV2 } from './architecture-goal-provenance';
import type { GoalReceiptPersistedScope, GoalReceiptProducerPorts } from './architecture-goal-receipt-producer';

/** Structural dependency surface, not a chat-module implementation import. */
export interface GoalAggregateAuditRef {
  readonly id: string;
  readonly runId: string;
  readonly rootSessionId: string;
  readonly label: string;
  readonly expectedDataSha256?: string;
}
export interface GoalAggregateAuditRecord {
  readonly id: string;
  readonly label: string;
  readonly data: Record<string, unknown>;
  readonly dataSha256: string;
}

/** Internal payload only. Final evidenceFingerprint includes this record's ID,
 * so embedding it here would create a content-addressed hash cycle. */
export interface GoalAggregateV1 {
  readonly schemaVersion: 1;
  readonly recordType: 'goal_completion_aggregate';
  readonly runId: string;
  readonly rootSessionId: string;
  readonly eventId: string;
  readonly sequence: number;
  readonly goalVersion: number;
  readonly sourceFingerprint: string;
  readonly goalFingerprint: string;
  readonly inventoryStateRevision: number;
  readonly sealCheckpointId: string;
  readonly completionPolicy: ArchitectureGoalPacketV1['completionPolicy'];
  readonly buildExpectation: GoalBuildExpectation | null;
  readonly attempts: readonly GoalAggregateAttemptV1[];
  readonly selectedBuildCallId: string | null;
  readonly supersededEvidenceIds: Readonly<Record<string, string>>;
}
export interface GoalAggregateAttemptV1 {
  readonly attemptId: string;
  readonly role: 'worker' | 'host_build';
  readonly identity: HostRuntimeReceiptIdentity;
  readonly scope: GoalReceiptPersistedScope;
  readonly previousCheckpointId: string | null;
  readonly phases: readonly { readonly phase: GoalAggregateAuditRef; readonly anchor: GoalAggregateAuditRef; readonly ack: GoalAggregateAuditRef }[];
  readonly terminal: { readonly kind: 'completed'; readonly record: CompletedChatRunRecord }
    | { readonly kind: 'terminal'; readonly record: TerminalChatRunRecord };
  readonly admissions: readonly { readonly callId: string; readonly originalSequence: number; readonly globalSequence: number }[];
}
/** Independently resolved host facts, not assertions parsed from producer metadata. */
export interface GoalDurableDispatchFacts {
  readonly identity: HostRuntimeReceiptIdentity;
  readonly callId: string;
  readonly requestedName: string;
  readonly argsSha256: string;
  readonly canonicalName: string | null;
  readonly target: 'kalio_registry' | 'external_mcp' | null;
  readonly approval: HostDispatchApproval | null;
  readonly hitlCommit: HostHitlExecutionCommit | null;
  readonly resultMessageId: string;
  readonly resultStatus: ToolResult['status'];
  readonly contentSha256: string;
}
export interface GoalProofScope {
  readonly runId: string;
  readonly rootSessionId: string;
  readonly goalVersion: number;
  readonly sourceFingerprint: string;
  readonly goalFingerprint: string;
  readonly inventoryStateRevision: number;
}
export interface GoalDispatchLocator {
  readonly identity: HostRuntimeReceiptIdentity;
  readonly callId: string;
}
export interface GoalTerminalOutputLink {
  readonly scope: GoalProofScope;
  readonly spawn: GoalDispatchLocator;
  readonly output: GoalDispatchLocator;
  readonly terminalId: string;
  readonly owner: { readonly sessionId: string; readonly turnId: string; readonly callId: string };
  readonly approvedCommand: {
    readonly approvedSource: GoalBuildExpectation['approvedSource'];
    readonly executable: string;
    readonly argv: readonly string[];
    readonly canonicalCwd: string;
    readonly shell: boolean;
  };
  readonly status: 'exited';
  readonly exitCode: 0;
}
export interface GoalEvidenceProjection {
  readonly scope: GoalProofScope;
  readonly evidenceId: string;
  readonly ref: GoalEvidenceRefV2;
  readonly dispatch: GoalDispatchLocator;
  readonly resultMessageId: string;
  readonly evidence: WorkflowEvidence;
}
export interface GoalDurableHitlRow {
  readonly id: string;
  readonly revision: number;
  readonly status: string;
  readonly executionState: string;
  readonly sessionId: string;
  readonly turnId: string;
  readonly runId: string;
  readonly toolCallId: string;
  readonly continuation: Readonly<Record<string, unknown>>;
  readonly outcome: Readonly<Record<string, unknown>>;
}
export interface GoalAggregateDurableAuthority {
  /** Required host capability resolves actual captured registry entry AND executor,
   * admitted args and result commit from registered durable dispatch authority.
   * Audit metadata cannot be its authority source. Missing restart capability must
   * return null. This slice supplies NO production adapter/default implementation. */
  readDispatchExact(identity: HostRuntimeReceiptIdentity, callId: string, signal?: AbortSignal): Promise<GoalDurableDispatchFacts | null>;
  readHitlExact(requestId: string, signal?: AbortSignal): Promise<GoalDurableHitlRow | null>;
  readChildExact(ref: GoalChildRefV2, signal?: AbortSignal): Promise<{ ref: GoalChildRefV2; status: WorkflowEvidenceStatus } | null>;
  /** Host-owned persisted linkage/slots, NOT inventory echoes or audit assertions.
   * Readers independently validate approved plan and original projection backing. */
  readTerminalOutputLinkExact(scope: GoalProofScope, spawn: GoalDispatchLocator, signal?: AbortSignal): Promise<GoalTerminalOutputLink | null>;
  readEvidenceProjectionExact(scope: GoalProofScope, evidenceId: string, ref: GoalEvidenceRefV2, signal?: AbortSignal): Promise<GoalEvidenceProjection | null>;
}
export interface GoalAggregateVerifierPorts {
  readonly repository: Pick<ArchitectureGoalRepository, 'load'>;
  readonly audit: { readGoalProofExact(locator: GoalAggregateAuditRef, signal?: AbortSignal): Promise<GoalAggregateAuditRecord> };
  readonly durableReader: ChatTerminalJournalEvidenceReaderPort;
  readonly sourceReader: ArchitectureGoalSourceReadPort;
  readonly persistedScope: GoalReceiptProducerPorts['persistedScope'];
  readonly authority: GoalAggregateDurableAuthority;
}
function fail(): never { throw new Error('GOAL_AGGREGATE_INVALID'); }
function abort(signal?: AbortSignal): void { if (signal?.aborted) throw new Error('GOAL_AGGREGATE_ABORTED'); }
function text(value: unknown): value is string { return typeof value === 'string' && value.trim().length > 0; }
function positive(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value > 0; }
function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function exact(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return object(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
/** Equality only; no independent goal/source/evidence fingerprint algorithm. */
function same(a: unknown, b: unknown): boolean {
  const sorted = (v: unknown): unknown => Array.isArray(v) ? v.map(sorted) : object(v)
    ? Object.fromEntries(Object.keys(v).sort().map(k => [k, sorted(v[k])])) : v;
  return JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));
}
function parse(raw: unknown): GoalAggregateV1 {
  const v = cloneGoalCompletionJson(raw);
  if (!exact(v, ['schemaVersion', 'recordType', 'runId', 'rootSessionId', 'eventId', 'sequence', 'goalVersion', 'sourceFingerprint',
    'goalFingerprint', 'inventoryStateRevision', 'sealCheckpointId', 'completionPolicy', 'buildExpectation', 'attempts', 'selectedBuildCallId', 'supersededEvidenceIds'])
    || v.schemaVersion !== 1 || v.recordType !== 'goal_completion_aggregate'
    || !['runId', 'rootSessionId', 'eventId', 'sourceFingerprint', 'goalFingerprint', 'sealCheckpointId'].every(k => text(v[k]))
    || ![v.sequence, v.goalVersion, v.inventoryStateRevision].every(positive)
    || !Array.isArray(v.attempts) || !v.attempts.length || !object(v.supersededEvidenceIds)
    || v.selectedBuildCallId !== null && !text(v.selectedBuildCallId)) return fail();
  for (const a of v.attempts) {
    if (!exact(a, ['attemptId', 'role', 'identity', 'scope', 'previousCheckpointId', 'phases', 'terminal', 'admissions'])
      || !text(a.attemptId) || !['worker', 'host_build'].includes(String(a.role))
      || !exact(a.identity, ['runId', 'sessionId', 'turnId', 'promptMessageId']) || !Object.values(a.identity).every(text)
      || !exact(a.scope, ['rootSessionId', 'branchSessionId', 'projectId', 'executionProfileId', 'parentSessionId', 'canonicalProjectRoot', 'canonicalCwd'])
      || !Object.values(a.scope).every(text) || a.previousCheckpointId !== null && !text(a.previousCheckpointId)
      || !Array.isArray(a.phases) || !a.phases.length || !Array.isArray(a.admissions)
      || !exact(a.terminal, ['kind', 'record']) || !['completed', 'terminal'].includes(String(a.terminal.kind))) return fail();
    for (const m of a.admissions) if (!exact(m, ['callId', 'originalSequence', 'globalSequence'])
      || !text(m.callId) || !positive(m.originalSequence) || !positive(m.globalSequence)) return fail();
    for (const s of a.phases) {
      if (!exact(s, ['phase', 'anchor', 'ack'])) return fail();
      for (const p of Object.values(s)) if (!exact(p, ['id', 'runId', 'rootSessionId', 'label', 'expectedDataSha256'])
        || !Object.values(p).every(text) || !/^[a-f0-9]{64}$/.test(String(p.expectedDataSha256))) return fail();
    }
  }
  return v as unknown as GoalAggregateV1;
}

/** Read-only port implementation. Never seals, calls Jev, writes CAS/ACK or registers
 * a module. Durable host adapters remain mandatory on authorization AND replay. */
export class ArchitectureGoalAggregateVerifier {
  constructor(private readonly ports: GoalAggregateVerifierPorts) {}
  async verifyDurableInventory(raw: ArchitectureGoalState, signal?: AbortSignal): Promise<void> {
    try {
      abort(signal);
      const state = cloneGoalCompletionJson(raw);
      const current = () => { abort(signal); if (!same(this.ports.repository.load(state.runId, state.rootSessionId), state)) return fail(); };
      const wait = async <T>(p: Promise<T>): Promise<T> => { const r = await p; current(); return cloneGoalCompletionJson(r); };
      if (!this.ports.authority || ['readDispatchExact', 'readHitlExact', 'readChildExact', 'readTerminalOutputLinkExact', 'readEvidenceProjectionExact'].some(k =>
        typeof this.ports.authority[k as keyof GoalAggregateDurableAuthority] !== 'function')) return fail();
      current();
      const stored = validateGoalCompletionState(state, state.evidenceInventory, state.completionAuthorization), inventory = stored.evidenceInventory;
      if (inventory?.schemaVersion !== 2 || inventory.provenance.checkpoint.status !== 'sealed' || state.packet.projection.status !== 'accepted') return fail();
      const provenance = inventory.provenance, checkpoint = provenance.checkpoint, ref = checkpoint.completedRunJournalRef;
      const proofScope: GoalProofScope = { runId: state.runId, rootSessionId: state.rootSessionId, goalVersion: state.packet.version,
        sourceFingerprint: state.packet.sourceFingerprint, goalFingerprint: state.packet.projection.snapshot.goalFingerprint,
        inventoryStateRevision: inventory.inventoryStateRevision };
      if (!ref) return fail();
      const rechecks: (() => Promise<void>)[] = [];
      const read = async (p: GoalAggregateAuditRef) => {
        if (p.runId !== state.runId || p.rootSessionId !== state.rootSessionId) return fail();
        const row = await wait(this.ports.audit.readGoalProofExact(p, signal));
        rechecks.push(async () => {
          if (!same(row, await wait(this.ports.audit.readGoalProofExact({ ...p, expectedDataSha256: row.dataSha256 }, signal)))) return fail();
        });
        return row;
      };
      const proof = await read({ id: ref.checkpointId, runId: state.runId, rootSessionId: state.rootSessionId, label: 'goal_completion:aggregate' });
      if (!proof.id.startsWith('goal-aggregate:sha256:')) return fail();
      const payload = parse(proof.data);
      if (payload.runId !== state.runId || payload.rootSessionId !== state.rootSessionId || payload.goalVersion !== state.packet.version
        || payload.sourceFingerprint !== state.packet.sourceFingerprint || payload.goalFingerprint !== state.packet.projection.snapshot.goalFingerprint
        || payload.eventId !== ref.eventId || payload.sequence !== ref.sequence || payload.sealCheckpointId !== checkpoint.checkpointId
        || payload.inventoryStateRevision !== inventory.inventoryStateRevision || !same(payload.completionPolicy, state.packet.completionPolicy)
        || !same(payload.buildExpectation, provenance.buildExpectation) || !same(payload.supersededEvidenceIds, provenance.supersededEvidenceIds)) return fail();
      const seal = await read({ id: checkpoint.checkpointId, runId: state.runId, rootSessionId: state.rootSessionId, label: 'goal_completion:sealed' });
      if (seal.data.aggregateId !== proof.id || seal.data.inventoryStateRevision !== inventory.inventoryStateRevision) return fail();
      for (const source of [state.packet.original, ...state.packet.updates]) {
        const check = async () => { if (!same(source, await wait(this.ports.sourceReader.read({
          messageId: source.messageId, sessionId: source.sessionId, turnId: source.turnId })))) return fail(); };
        await check(); rechecks.push(check);
      }
      const facts = new Map<string, GoalDurableDispatchFacts>(), phaseRows = new Map<string, GoalAggregateAuditRecord>();
      const results = new Map<string, string>();
      const unique = new Set<string>([proof.id, seal.id]), journals = new Set<string>(), attempts = new Set<string>();
      let previous: string | null = null, revision: number | null = null;
      for (const a of payload.attempts) {
        if (attempts.has(a.attemptId) || journals.has(a.identity.runId) || a.scope.rootSessionId !== state.rootSessionId
          || a.scope.branchSessionId !== a.identity.sessionId || a.scope.parentSessionId !== state.rootSessionId || a.previousCheckpointId !== previous) return fail();
        attempts.add(a.attemptId); journals.add(a.identity.runId);
        const scopeKey = { rootSessionId: state.rootSessionId, branchSessionId: a.scope.branchSessionId,
          projectId: a.scope.projectId, executionProfileId: a.scope.executionProfileId };
        if (!same(await wait(this.ports.persistedScope.readRegisteredScope(scopeKey)), a.scope)) return fail();
        const admitted = new Map<string, GoalAggregateAuditRecord>(), committed = new Map<string, GoalAggregateAuditRecord>();
        const resolved = new Map<string, Record<string, unknown>>();
        let opened = false, drained = false, terminal = false;
        let allowed: readonly string[] = [];
        for (const [i, step] of a.phases.entries()) {
          for (const p of [step.phase, step.anchor, step.ack]) { if (unique.has(p.id)) return fail(); unique.add(p.id); }
          const phase = await read(step.phase), anchor = await read(step.anchor), ack = await read(step.ack);
          for (const row of [phase, anchor, ack]) if (row.data.attemptId !== a.attemptId || row.data.goalVersion !== state.packet.version
            || row.data.sourceFingerprint !== payload.sourceFingerprint || row.data.goalFingerprint !== payload.goalFingerprint
            || !same(row.data.scope, a.scope)) return fail();
          const d = phase.data;
          if (d.recordType !== 'phase' || phase.label !== `goal_receipt:${d.phase}` || d.phaseSequence !== i + 1
            || !positive(d.expectedStateRevision) || revision !== null && d.expectedStateRevision !== revision
            || d.previousCheckpointId !== previous || d.phase !== 'opened' && !same(d.identity, a.identity)
            || anchor.label !== 'goal_receipt:inventory_anchor' || anchor.data.recordType !== 'inventory_anchor'
            || anchor.data.phaseEventId !== phase.id || anchor.data.previousCheckpointId !== previous
            || anchor.data.expectedStateRevision !== d.expectedStateRevision || ack.label !== 'goal_receipt:cas_ack'
            || ack.data.recordType !== 'cas_ack' || ack.data.phaseEventId !== phase.id || ack.data.inventoryCheckpointId !== anchor.id
            || ack.data.stateRevision !== d.expectedStateRevision + 1) return fail();
          phaseRows.set(phase.id, phase); previous = anchor.id; revision = ack.data.stateRevision as number;
          if (d.phase === 'opened') {
            if (opened || i !== 0 || !Array.isArray(d.allowedToolNames) || !d.allowedToolNames.every(text)
              || new Set(d.allowedToolNames).size !== d.allowedToolNames.length) return fail();
            opened = true; allowed = d.allowedToolNames;
          } else if (!opened) return fail();
          else if (d.phase === 'admitted') {
            if (drained || !text(d.callId) || admitted.has(d.callId) || d.sequence !== admitted.size + 1) return fail();
            admitted.set(d.callId, phase);
          } else if (d.phase === 'resolved') {
            if (drained || !text(d.callId) || !admitted.has(d.callId) || committed.has(d.callId) || resolved.has(d.callId)
              || !object(d.resolved) || !same(d.resolved.identity, a.identity) || d.resolved.callId !== d.callId
              || d.resolved.requestedName !== admitted.get(d.callId)!.data.requestedName
              || d.resolved.argsSha256 !== admitted.get(d.callId)!.data.argsSha256
              || !text(d.resolved.canonicalName) || !allowed.includes(d.resolved.canonicalName)) return fail();
            resolved.set(d.callId, d.resolved);
          } else if (d.phase === 'committed') {
            if (drained || !text(d.callId) || !admitted.has(d.callId) || committed.has(d.callId)) return fail();
            // Pre-entry resolution is diagnostic only. A cancelled commit may
            // retain that phase while truthfully carrying no entered target.
            if (d.resolved === null ? d.status !== 'cancelled' : !same(d.resolved, resolved.get(d.callId) ?? null)) return fail();
            const prior = resolved.get(d.callId)?.approval;
            if (d.resolved === null && object(prior) && prior.kind === 'durable_confirmation'
              && (!object(d.hitlCommit) || d.hitlCommit.requestId !== prior.requestId || d.hitlCommit.claimedRevision !== prior.claimedRevision)) return fail();
            committed.set(d.callId, phase);
          } else if (d.phase === 'drained') {
            if (drained || admitted.size !== committed.size || d.admittedCount !== admitted.size || d.committedCount !== admitted.size) return fail();
            drained = true;
          } else if (d.phase === 'journal_verified' || d.phase === 'journal_terminal_verified') {
            if (!drained || terminal || i !== a.phases.length - 1 || !same(d.journal, a.terminal.record)) return fail();
            const expected = a.terminal.record;
            if (a.terminal.kind === 'completed') {
              if (d.phase !== 'journal_verified') return fail();
              const j = a.terminal.record;
              const check = async () => { if (!same(await wait(this.ports.durableReader.readCompletedRunExact({ chatRunId: j.chatRunId, sessionId: j.sessionId,
                turnId: j.turnId, promptMessageId: j.promptMessageId, revision: j.revision, terminalMessageId: j.terminalMessageId })), j)) return fail(); };
              await check(); rechecks.push(check);
            } else {
              if (d.phase !== 'journal_terminal_verified') return fail();
              const j = a.terminal.record;
              const locator = { chatRunId: j.chatRunId, sessionId: j.sessionId, turnId: j.turnId, promptMessageId: j.promptMessageId,
                revision: j.revision, status: j.status, phase: j.phase, outcomeMessageId: j.outcomeMessageId };
              const check = async () => { if (!same(await wait(this.ports.durableReader.readTerminalRunExact(locator)), expected)) return fail(); };
              await check(); rechecks.push(check);
            }
            if (expected.chatRunId !== a.identity.runId || expected.sessionId !== a.identity.sessionId
              || expected.turnId !== a.identity.turnId || expected.promptMessageId !== a.identity.promptMessageId) return fail();
            terminal = true;
          } else return fail();
        }
        if (!terminal || admitted.size !== a.admissions.length) return fail();
        for (const m of a.admissions) {
          const admission = admitted.get(m.callId), commit = committed.get(m.callId), global = checkpoint.admissions[m.globalSequence - 1];
          const globalCommit = checkpoint.commits.find(row => row.callId === m.callId);
          if (!admission || !commit || facts.has(m.callId) || !global || !globalCommit || m.originalSequence !== admission.data.sequence
            || global.callId !== m.callId || global.admissionCheckpointId !== admission.id || globalCommit.commitCheckpointId !== commit.id
            || global.sessionId !== a.identity.sessionId || global.turnId !== a.identity.turnId || global.promptMessageId !== a.identity.promptMessageId
            || globalCommit.status !== commit.data.status) return fail();
          const actual = await wait(this.ports.authority.readDispatchExact(a.identity, m.callId, signal));
          if (!actual || !same(actual.identity, a.identity) || actual.callId !== m.callId || actual.requestedName !== admission.data.requestedName
            || actual.argsSha256 !== admission.data.argsSha256 || actual.argsSha256 !== commit.data.argsSha256
            || actual.requestedName !== commit.data.requestedName || actual.resultMessageId !== globalCommit.resultMessageId
            || actual.resultStatus !== globalCommit.status || !same(actual.hitlCommit, commit.data.hitlCommit) || !object(commit.data.result)) return fail();
          const result = await wait(this.ports.durableReader.readToolResultExact({ messageId: actual.resultMessageId,
            sessionId: a.identity.sessionId, turnId: a.identity.turnId, promptMessageId: a.identity.promptMessageId, toolCallId: m.callId, role: 'tool_result' }));
          if (!result || result.contentSha256 !== actual.contentSha256) return fail();
          if (actual.target === null) {
            if (actual.canonicalName !== null || actual.approval !== null || actual.resultStatus !== 'cancelled'
              || commit.data.resolved !== null) return fail();
          } else if (actual.target !== 'kalio_registry' || !text(actual.canonicalName) || !actual.approval
            || !object(commit.data.resolved) || commit.data.resolved.canonicalName !== actual.canonicalName
            || !same(commit.data.resolved.approval, actual.approval)
            || !object(commit.data.resolved.target) || commit.data.resolved.target.kind !== actual.target) return fail();
          const metadata = { ...result }; Reflect.deleteProperty(metadata, 'content');
          if (!same(metadata, commit.data.result)) return fail();
          rechecks.push(async () => {
            if (!same(actual, await wait(this.ports.authority.readDispatchExact(a.identity, m.callId, signal)))) return fail();
            if (!same(result, await wait(this.ports.durableReader.readToolResultExact({ messageId: actual.resultMessageId,
              sessionId: a.identity.sessionId, turnId: a.identity.turnId, promptMessageId: a.identity.promptMessageId, toolCallId: m.callId, role: 'tool_result' })))) return fail();
          });
          if (actual.approval?.kind === 'durable_confirmation' || actual.hitlCommit !== null) rechecks.push(await this.hitl(actual, wait, signal, false));
          facts.set(m.callId, actual);
          results.set(m.callId, result.content);
        }
        if (!same(await wait(this.ports.persistedScope.readRegisteredScope(scopeKey)), a.scope)) return fail();
      }
      if (facts.size !== checkpoint.admissions.length || revision === null || revision + 1 !== inventory.inventoryStateRevision) return fail();
      for (const [id, r] of Object.entries(provenance.evidenceRefsById)) {
        const fact = facts.get(r.dispatchCallId), row = phaseRows.get(r.checkpointId);
        const projection = await wait(this.ports.authority.readEvidenceProjectionExact(cloneGoalCompletionJson(proofScope), id, cloneGoalCompletionJson(r), signal));
        if (!fact || fact.target !== 'kalio_registry' || !row || row.data.phase !== 'committed' || row.data.callId !== fact.callId
          || r.eventId !== row.id || r.sequence !== checkpoint.admissions.find(x => x.callId === fact.callId)?.sequence
          || !projection || !exact(projection, ['scope', 'evidenceId', 'ref', 'dispatch', 'resultMessageId', 'evidence'])
          || !same(projection.scope, proofScope) || projection.evidenceId !== id || !same(projection.ref, r)
          || !same(projection.dispatch, { identity: fact.identity, callId: fact.callId }) || projection.resultMessageId !== fact.resultMessageId
          || !object(projection.evidence) || !['BUILD_RESULT', 'GIT_STATUS', 'FINAL_ARTIFACT', 'QUALITY_GATE', 'TOOL_RESULT',
            'CLI_CHILD', 'VFS_WRITE', 'VFS_READ'].includes(projection.evidence.kind)
          || !['passed', 'failed', 'blocked', 'unknown'].includes(projection.evidence.status)
          || Object.keys(projection.evidence).some(k => !['kind', 'status', 'source', 'data'].includes(k))
          || Object.hasOwn(projection.evidence, 'source') && typeof projection.evidence.source !== 'string'
          || Object.hasOwn(projection.evidence, 'data') && !object(projection.evidence.data)
          || !Object.hasOwn(provenance.supersededEvidenceIds, id)
            && !same(projection.evidence, inventory.host.evidenceById[id])) return fail();
        rechecks.push(async () => {
          if (!same(projection, await wait(this.ports.authority.readEvidenceProjectionExact(cloneGoalCompletionJson(proofScope), id, cloneGoalCompletionJson(r), signal)))) return fail();
        });
      }
      for (const [id, childRef] of Object.entries(provenance.childRefsById)) {
        const child = await wait(this.ports.authority.readChildExact(childRef, signal));
        if (!child || !same(child.ref, childRef) || child.status !== inventory.host.cliChildrenById[id]) return fail();
      }
      if (provenance.buildExpectation !== null) {
        const selected = facts.get(payload.selectedBuildCallId ?? ''), a = payload.attempts.find(row => row.admissions.some(x => x.callId === payload.selectedBuildCallId));
        if (!selected || a?.role !== 'host_build' || a.terminal.kind !== 'completed' || selected.target !== 'kalio_registry'
          || provenance.buildExpectation.canonicalCwd !== a.scope.canonicalCwd
          || selected.canonicalName !== 'terminal_spawn' || selected.resultStatus !== 'success') return fail();
        const spawn = { identity: selected.identity, callId: selected.callId };
        const link = await wait(this.ports.authority.readTerminalOutputLinkExact(cloneGoalCompletionJson(proofScope), cloneGoalCompletionJson(spawn), signal));
        if (!link || !exact(link, ['scope', 'spawn', 'output', 'terminalId', 'owner', 'approvedCommand', 'status', 'exitCode'])
          || !same(link.scope, proofScope) || !same(link.spawn, spawn) || !text(link.terminalId)
          || !same(link.owner, { sessionId: selected.identity.sessionId, turnId: selected.identity.turnId, callId: selected.callId })
          || !exact(link.approvedCommand, ['approvedSource', 'executable', 'argv', 'canonicalCwd', 'shell'])
          || typeof link.approvedCommand.shell !== 'boolean'
          || !same({ approvedSource: link.approvedCommand.approvedSource, executable: link.approvedCommand.executable,
            args: link.approvedCommand.argv, canonicalCwd: link.approvedCommand.canonicalCwd }, provenance.buildExpectation)
          || link.status !== 'exited' || link.exitCode !== 0) return fail();
        const output = facts.get(link.output.callId), leaf = payload.attempts.find(row => same(row.identity, link.output.identity)
          && row.admissions.some(m => m.callId === link.output.callId));
        if (!output || !same(link.output, { identity: output.identity, callId: output.callId }) || output.callId === selected.callId
          || output.target !== 'kalio_registry' || output.canonicalName !== 'terminal_output' || output.resultStatus !== 'success'
          || leaf?.role !== 'host_build' || leaf.terminal.kind !== 'completed' || !same(leaf.scope, a.scope)) return fail();
        const descriptor = { terminalId: link.terminalId, executable: link.approvedCommand.executable, argv: link.approvedCommand.argv,
          actualCwd: link.approvedCommand.canonicalCwd, shell: link.approvedCommand.shell, ownerIdentity: link.owner };
        const spawned: unknown = JSON.parse(results.get(selected.callId)!), exited: unknown = JSON.parse(results.get(output.callId)!);
        if (!exact(spawned, ['id', 'pid', 'command', 'executionDescriptor']) || spawned.id !== link.terminalId
          || !positive(spawned.pid) || !text(spawned.command) || !same(spawned.executionDescriptor, descriptor)
          || !exact(exited, ['id', 'status', 'exitCode', 'output', 'executionDescriptor']) || exited.id !== link.terminalId
          || exited.status !== 'exited' || exited.exitCode !== 0 || typeof exited.output !== 'string'
          || !same(exited.executionDescriptor, descriptor)) return fail();
        rechecks.push(async () => {
          if (!same(link, await wait(this.ports.authority.readTerminalOutputLinkExact(cloneGoalCompletionJson(proofScope), cloneGoalCompletionJson(spawn), signal)))) return fail();
        });
        rechecks.push(await this.hitl(selected, wait, signal, true));
        const buildRefs = Object.entries(inventory.host.evidenceById).filter(([, row]) => row.kind === 'BUILD_RESULT' && row.status === 'passed');
        if (!buildRefs.length || buildRefs.some(([id]) => provenance.evidenceRefsById[id]?.dispatchCallId !== output.callId)) return fail();
      } else if (payload.selectedBuildCallId !== null) return fail();
      inspectGoalCompletion(state.packet, state.completionAuthorization?.criterionEvidenceIds
        ?? Object.fromEntries(Object.keys(state.packet.completionPolicy.requiredEvidenceKindsByCriterion).map(id => [id, []])),
        inventory.host, { runId: state.runId, rootSessionId: state.rootSessionId, provenance });
      for (const recheck of rechecks) await recheck();
      current();
    } catch { abort(signal); return fail(); }
  }
  private async hitl(fact: GoalDurableDispatchFacts, wait: <T>(promise: Promise<T>) => Promise<T>, signal: AbortSignal | undefined, humanOnly: boolean): Promise<() => Promise<void>> {
    const approval = fact.approval, receipt = fact.hitlCommit;
    if (!receipt || !positive(receipt.claimedRevision) || !positive(receipt.committedRevision) || receipt.committedRevision <= receipt.claimedRevision
      || (approval?.kind === 'durable_confirmation' ? receipt.requestId !== approval.requestId || receipt.claimedRevision !== approval.claimedRevision
        : fact.target !== null || fact.resultStatus !== 'cancelled')
      || receipt.resultStatus !== fact.resultStatus || receipt.status !== 'approved' || receipt.executionState !== 'tool_result_committed') return fail();
    const row = await wait(this.ports.authority.readHitlExact(receipt.requestId, signal));
    if (!row || row.id !== receipt.requestId || row.revision !== receipt.committedRevision || row.status !== 'approved'
      || row.executionState !== 'tool_result_committed' || row.sessionId !== fact.identity.sessionId || row.turnId !== fact.identity.turnId
      || row.runId !== fact.identity.runId || row.toolCallId !== fact.callId || row.continuation.promptMessageId !== fact.identity.promptMessageId
      || row.outcome.status !== fact.resultStatus) return fail();
    if (humanOnly) {
      const r = row.continuation.hostConfirmationRequirement, o = row.continuation.approvalOrigin;
      if (!exact(r, ['kind', 'toolName', 'callId']) || r.kind !== 'human_only' || r.toolName !== 'terminal_spawn' || r.callId !== fact.callId
        || !exact(o, ['schemaVersion', 'kind', 'requestId', 'sessionId', 'toolCallId', 'socketId', 'approvedFromRevision'])
        || o.schemaVersion !== 1 || o.kind !== 'gateway_tool_confirm' || o.requestId !== row.id || o.sessionId !== row.sessionId
        || o.toolCallId !== fact.callId || !text(o.socketId) || !positive(o.approvedFromRevision) || o.approvedFromRevision >= receipt.claimedRevision) return fail();
    }
    return async () => { if (!same(row, await wait(this.ports.authority.readHitlExact(receipt.requestId, signal)))) return fail(); };
  }
}
