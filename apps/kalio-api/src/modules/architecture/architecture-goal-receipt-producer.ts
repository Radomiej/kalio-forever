import { createHash, randomUUID } from 'node:crypto';
import { types } from 'node:util';
import type { ArchitectureRun, ChatDurableEvidenceReaderPort, HostResolvedToolDispatch, HostRuntimeReceiptObserver,
  HostRuntimeReceiptIdentity, HostRuntimeToolAdmission, HostRuntimeToolCommit } from '@kalio/types';
import type { ArchitectureGoalRepository, ArchitectureGoalState } from './architecture-goal.repository';
import type { ArchitectureGoalSourceReadPort } from './architecture-goal-lifecycle.service';
import type { GoalBuildExpectation } from './architecture-goal-provenance';
import type { GoalEvidenceInventoryV2 } from './architecture-goal-completion-state';

export type RegisteredReceiptTool = Pick<HostResolvedToolDispatch, 'canonicalName'> & {
  readonly target: Extract<HostResolvedToolDispatch['target'], { kind: 'kalio_registry' }>;
};
export interface GoalReceiptScopeKey {
  readonly rootSessionId: string;
  readonly branchSessionId: string;
  readonly projectId: string;
  readonly executionProfileId: string;
}
export interface GoalReceiptPersistedScope extends GoalReceiptScopeKey {
  readonly parentSessionId: string;
  readonly canonicalProjectRoot: string;
  readonly canonicalCwd: string;
}
export interface GoalReceiptProducerPorts {
  readonly repository: Pick<ArchitectureGoalRepository, 'load' | 'replaceEvidenceInventory'>;
  readonly audit: {
    logRequired(id: string, entry: { sessionId: string; type: 'architecture_event'; label: string; data: Record<string, unknown> }): Promise<void>;
  };
  readonly durableReader: ChatDurableEvidenceReaderPort;
  readonly sourceReader: ArchitectureGoalSourceReadPort;
  readonly registry: { snapshot(): readonly RegisteredReceiptTool[] };
  /** Host adapter must resolve the actual child -> architecture root linkage,
   * matching persisted project/profile (assertEnabled), and VFS realpath/containment.
   * The human source session is independent. No context cwd/default/boolean verifier. */
  readonly persistedScope: { readRegisteredScope(key: GoalReceiptScopeKey): Promise<GoalReceiptPersistedScope> };
}
export interface GoalReceiptApprovedScope {
  readonly branchSessionId: string;
  readonly projectId: string;
  readonly executionProfileId: string;
  readonly allowedToolNames: readonly string[];
  readonly buildExpectation: GoalBuildExpectation | null;
}

const fail = (): never => { throw new Error('GOAL_RECEIPT_FAILED'); };
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const positive = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const sha = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');

/** Inspect before reads; object capabilities are handled separately, never cloned. */
function properties<T extends object>(value: T, keys?: readonly string[]): T {
  if (!value || typeof value !== 'object' || types.isProxy(value) || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value) as object | null)) return fail();
  const own = Reflect.ownKeys(value);
  if (own.some(key => typeof key !== 'string') || (keys && (own.length !== keys.length || keys.some(key => !Object.hasOwn(value, key))))) return fail();
  for (const key of own) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) return fail();
  }
  return value;
}
function detached<T>(value: T, ancestors = new Set<object>()): T {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (!value || typeof value !== 'object' || types.isProxy(value) || ancestors.has(value) || ancestors.size >= 100) return fail();
  const array = Array.isArray(value);
  if (array) {
    if (Object.getPrototypeOf(value) !== Array.prototype || Reflect.ownKeys(value).length !== value.length + 1) return fail();
  } else properties(value);
  ancestors.add(value);
  try {
    if (array) return Array.from({ length: value.length }, (_, index) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) return fail();
      return detached(descriptor.value as unknown, ancestors);
    }) as T;
    return Object.fromEntries(Object.keys(value).sort().map(key => [key,
      detached(Object.getOwnPropertyDescriptor(value, key)!.value as unknown, ancestors)])) as T;
  } finally { ancestors.delete(value); }
}
const encoded = (value: unknown): string => JSON.stringify(detached(value));
const same = (left: unknown, right: unknown): boolean => encoded(left) === encoded(right);
type InventoryInput = Omit<GoalEvidenceInventoryV2, 'inventoryStateRevision'>;
type CallRecord = { admission: HostRuntimeToolAdmission; argsSha256: string; sequence: number;
  resolved: Record<string, unknown> | null; committed: boolean };

/** Receipts-only producer. It NEVER seals, attaches evidence/criteria or authorizes
 * completion. Existing inventory is rejected: repeated attempts require an explicit
 * host supersession transition preserving prior commit/evidence provenance. Parent
 * host BUILD + workspace verification must consume this chain before sealing.
 * All injected authorities are host adapters; there is no production fallback.
 * Parent composition must forward only the actual host subagent lifecycle identity
 * (journal/session/turn/prompt), not model/native/replay inputs. The completed-only
 * reader does not supply active-journal pre-execution authority. */
export class ArchitectureGoalReceiptProducer {
  constructor(private readonly ports: GoalReceiptProducerPorts) {}

  async create(run: Pick<ArchitectureRun, 'id' | 'rootSessionId' | 'schemaId'>,
    expectedStateRevision: number, approved: GoalReceiptApprovedScope, signal: AbortSignal): Promise<HostRuntimeReceiptObserver> {
    try {
      run = detached(run); approved = detached(approved);
      if (![run.id, run.rootSessionId, run.schemaId, approved.branchSessionId, approved.projectId, approved.executionProfileId].every(text)
        || !positive(expectedStateRevision) || !Array.isArray(approved.allowedToolNames)
        || !approved.allowedToolNames.every(text) || new Set(approved.allowedToolNames).size !== approved.allowedToolNames.length) return fail();
      const rootSessionId = run.rootSessionId;
      if (!text(rootSessionId)) return fail();
      signal.throwIfAborted();
      let state = this.ports.repository.load(run.id, run.rootSessionId);
      if (!state || state.stateRevision !== expectedStateRevision || state.evidenceInventory !== null
        || state.completionAuthorization !== null || state.packet.projection.status !== 'accepted') return fail();
      state = detached(state);
      const packet = detached(state.packet);
      if (packet.projection.status !== 'accepted') return fail();
      const key: GoalReceiptScopeKey = { rootSessionId, branchSessionId: approved.branchSessionId,
        projectId: approved.projectId, executionProfileId: approved.executionProfileId };
      const scope = detached(await this.ports.persistedScope.readRegisteredScope(key));
      if (!same(key, { rootSessionId: scope.rootSessionId, branchSessionId: scope.branchSessionId,
        projectId: scope.projectId, executionProfileId: scope.executionProfileId })
        || scope.parentSessionId !== run.rootSessionId || ![scope.canonicalProjectRoot, scope.canonicalCwd].every(text)) return fail();
      if (approved.buildExpectation !== null && approved.buildExpectation.canonicalCwd !== scope.canonicalCwd) return fail();
      const tools = new Map<string, RegisteredReceiptTool>();
      const readTools = (): Map<string, RegisteredReceiptTool> => {
        const found = new Map<string, RegisteredReceiptTool>();
        for (const row of this.ports.registry.snapshot()) {
          properties(row, ['canonicalName', 'target']); properties(row.target, ['kind', 'entryIdentity', 'executorIdentity', 'requiresConfirmation']);
          if (!text(row.canonicalName) || found.has(row.canonicalName) || row.target.kind !== 'kalio_registry'
            || typeof row.target.entryIdentity !== 'object' || row.target.entryIdentity === null
            || typeof row.target.executorIdentity !== 'function' || typeof row.target.requiresConfirmation !== 'boolean') return fail();
          found.set(row.canonicalName, { canonicalName: row.canonicalName, target: { ...row.target } });
        }
        return found;
      };
      const initialTools = readTools();
      for (const name of approved.allowedToolNames) {
        const tool = initialTools.get(name); if (!tool) return fail(); tools.set(name, tool);
      }
      const attemptId = randomUUID();
      let poisoned = false;
      let admissionClosed = false;
      let drained = false;
      let journalVerified = false;
      let boundIdentity: HostRuntimeReceiptIdentity | undefined;
      let chain: Promise<void> = Promise.resolve();
      let phaseSequence = 0;
      const calls = new Map<string, CallRecord>(); // Detached arguments/capabilities only; durable ledger is repository-owned.
      const assertState = (): ArchitectureGoalState => {
        if (poisoned || signal.aborted) return fail();
        const current = this.ports.repository.load(run.id, run.rootSessionId);
        if (!current || !same(current, state) || !same(current.packet, packet)) return fail();
        return current;
      };
      const guard = async (): Promise<void> => {
        assertState();
        const actualScope = detached(await this.ports.persistedScope.readRegisteredScope(key));
        assertState(); if (!same(actualScope, scope)) return fail();
        for (const source of [packet.original, ...packet.updates]) {
          const actual = await this.ports.sourceReader.read({ messageId: source.messageId, sessionId: source.sessionId, turnId: source.turnId });
          assertState(); if (!actual || !same(actual, source)) return fail();
        }
        const finalScope = detached(await this.ports.persistedScope.readRegisteredScope(key));
        assertState(); if (!same(finalScope, scope)) return fail();
        const freshTools = readTools();
        for (const [name, tool] of tools) {
          const fresh = freshTools.get(name);
          if (!fresh || fresh.target.entryIdentity !== tool.target.entryIdentity || fresh.target.executorIdentity !== tool.target.executorIdentity
            || fresh.target.requiresConfirmation !== tool.target.requiresConfirmation) return fail();
        }
        assertState();
      };
      const identityFor = (raw: HostRuntimeReceiptIdentity): HostRuntimeReceiptIdentity => {
        const actual = detached(properties(raw, ['runId', 'sessionId', 'turnId', 'promptMessageId']));
        if (!Object.values(actual).every(text) || actual.sessionId !== approved.branchSessionId
          || (boundIdentity && !same(boundIdentity, actual))) return fail();
        boundIdentity ??= actual;
        return actual;
      };
      const metadata = { schemaVersion: 1, attemptId, architectureRunId: run.id, rootSessionId: run.rootSessionId, schemaId: run.schemaId,
        goalVersion: packet.version, sourceFingerprint: packet.sourceFingerprint, goalFingerprint: packet.projection.snapshot.goalFingerprint,
        policySha256: sha(encoded(packet.completionPolicy)), scope };
      let inventory: InventoryInput = {
        schemaVersion: 2, runId: run.id, rootSessionId: run.rootSessionId, goalVersion: packet.version, sourceFingerprint: packet.sourceFingerprint,
        host: { evidenceById: {}, cliChildrenById: {} }, provenance: { schemaVersion: 2, runId: run.id, rootSessionId: run.rootSessionId,
          goalVersion: packet.version, sourceFingerprint: packet.sourceFingerprint, goalFingerprint: packet.projection.snapshot.goalFingerprint,
          checkpoint: { checkpointId: attemptId, status: 'open', admissions: [], commits: [], completedRunJournalRef: null },
          evidenceRefsById: {}, childRefsById: {}, supersededEvidenceIds: {}, buildExpectation: approved.buildExpectation },
      };
      const persist = async (phase: string, data: Record<string, unknown>, update?: (next: InventoryInput, eventId: string) => InventoryInput,
        readback?: () => Promise<void>): Promise<void> => {
        // Private closures below use the actual durable reader; this is NOT an injected verifier port.
        const check = async () => { await guard(); if (readback) { await readback(); await guard(); } };
        await check();
        const eventId = randomUUID(); const anchorId = randomUUID();
        const previousCheckpointId = state!.evidenceInventory?.schemaVersion === 2 ? state!.evidenceInventory.provenance.checkpoint.checkpointId : null;
        const phaseData = { ...metadata, recordType: 'phase', phase, phaseSequence: ++phaseSequence,
          expectedStateRevision: state!.stateRevision, previousCheckpointId, ...data };
        await this.ports.audit.logRequired(eventId, { sessionId: rootSessionId, type: 'architecture_event', label: `goal_receipt:${phase}`, data: phaseData });
        await check();
        await this.ports.audit.logRequired(anchorId, { sessionId: rootSessionId, type: 'architecture_event', label: 'goal_receipt:inventory_anchor',
          data: { ...metadata, recordType: 'inventory_anchor', phase: 'inventory_anchor', phaseEventId: eventId,
            previousCheckpointId, expectedStateRevision: state!.stateRevision } });
        await check();
        const updated = update?.(detached(inventory), eventId) ?? detached(inventory);
        const next = { ...updated, provenance: { ...updated.provenance, checkpoint: { ...updated.provenance.checkpoint, checkpointId: anchorId } } };
        const returned = this.ports.repository.replaceEvidenceInventory(run.id, state!.stateRevision, rootSessionId, next, Math.max(Date.now(), state!.updatedAt));
        if (!positive(returned.stateRevision) || returned.stateRevision <= state!.stateRevision || !same(returned.packet, packet)
          || returned.evidenceInventory?.schemaVersion !== 2 || returned.evidenceInventory.inventoryStateRevision !== returned.stateRevision
          || !same(returned.evidenceInventory, { ...next, inventoryStateRevision: returned.stateRevision }) || returned.completionAuthorization !== null) return fail();
        state = detached(returned); inventory = next;
        await check();
        await this.ports.audit.logRequired(randomUUID(), { sessionId: rootSessionId, type: 'architecture_event', label: 'goal_receipt:cas_ack',
          data: { ...metadata, recordType: 'cas_ack', phase: 'cas_ack', forPhase: phase, phaseEventId: eventId,
            inventoryCheckpointId: anchorId, stateRevision: returned.stateRevision } });
        await check();
      };
      const enqueue = (task: () => Promise<void>, acceptsAdmission = false): Promise<void> => {
        if (poisoned || signal.aborted || (acceptsAdmission && admissionClosed)) {
          poisoned = true; return Promise.reject(new Error('GOAL_RECEIPT_FAILED'));
        }
        const next = chain.then(async () => {
          if (poisoned || signal.aborted) return fail();
          await guard(); await task(); await guard();
        }).catch(() => { poisoned = true; return fail(); });
        // Keep the serialization lane settled; poisoning, not retries, rejects all successors.
        chain = next.then(() => undefined, () => { poisoned = true; });
        return next;
      };
      const receive = <T>(capture: () => T, task: (value: T) => Promise<void>, acceptsAdmission = false): Promise<void> => {
        try {
          const value = capture(); // Delivery snapshot, before the first await or queued mutation.
          return enqueue(() => task(value), acceptsAdmission);
        } catch { poisoned = true; return Promise.reject(new Error('GOAL_RECEIPT_FAILED')); }
      };
      const captureResolved = (raw: HostResolvedToolDispatch): HostResolvedToolDispatch => {
        properties(raw, ['identity', 'callId', 'requestedName', 'canonicalName', 'args', 'target', 'approval']); properties(raw.target);
        return { identity: detached(raw.identity), callId: raw.callId, requestedName: raw.requestedName, canonicalName: raw.canonicalName,
          args: detached(raw.args), target: { ...raw.target }, approval: detached(raw.approval) };
      };
      const resolvedData = (raw: HostResolvedToolDispatch, call: CallRecord): Record<string, unknown> => {
        properties(raw, ['identity', 'callId', 'requestedName', 'canonicalName', 'args', 'target', 'approval']);
        identityFor(raw.identity);
        const target = properties(raw.target);
        const tool = tools.get(raw.canonicalName);
        if (!tool || target.kind !== 'kalio_registry') return fail();
        properties(target, ['kind', 'entryIdentity', 'executorIdentity', 'requiresConfirmation']);
        if (raw.callId !== call.admission.callId || raw.requestedName !== call.admission.toolName || raw.canonicalName !== tool.canonicalName
          || target.entryIdentity !== tool.target.entryIdentity || target.executorIdentity !== tool.target.executorIdentity
          || target.requiresConfirmation !== tool.target.requiresConfirmation || sha(encoded(raw.args)) !== call.argsSha256) return fail();
        const approval = detached(raw.approval);
        if (approval.kind === 'durable_confirmation') {
          properties(approval, ['kind', 'requestId', 'claimedRevision']);
          if (!text(approval.requestId) || !positive(approval.claimedRevision)) return fail();
        } else {
          properties(approval, ['kind', 'reason']);
          if (approval.kind !== 'non_durable' || !['not_required', 'policy', 'representative', 'subagent_auto', 'explicit_bypass', 'legacy_confirmation'].includes(approval.reason)) return fail();
        }
        return { identity: call.admission.identity, callId: raw.callId, requestedName: raw.requestedName, canonicalName: raw.canonicalName,
          argsSha256: call.argsSha256, target: { kind: 'kalio_registry', requiresConfirmation: target.requiresConfirmation }, approval };
      };
      await persist('opened', { allowedToolNames: approved.allowedToolNames });
      return Object.freeze({
        admit: (raw: HostRuntimeToolAdmission) => receive(() => detached(properties(raw, ['identity', 'callId', 'toolName', 'args'])), async call => {
          identityFor(call.identity);
          if (!text(call.callId) || !text(call.toolName) || calls.has(call.callId)) return fail();
          properties(call.args);
          const record: CallRecord = { admission: call, argsSha256: sha(encoded(call.args)), sequence: calls.size + 1, resolved: null, committed: false };
          await persist('admitted', { identity: call.identity, callId: call.callId, requestedName: call.toolName, argsSha256: record.argsSha256, sequence: record.sequence }, (next, id) => {
            return { ...next, provenance: { ...next.provenance, checkpoint: { ...next.provenance.checkpoint,
              admissions: [...next.provenance.checkpoint.admissions, { sessionId: call.identity.sessionId, turnId: call.identity.turnId,
                promptMessageId: call.identity.promptMessageId, callId: call.callId, sequence: record.sequence, admissionCheckpointId: id }] } } };
          });
          calls.set(call.callId, record);
        }, true),
        resolvedDispatch: (receipt: HostResolvedToolDispatch) => receive(() => captureResolved(receipt), async raw => {
          properties(raw); const call = calls.get(raw.callId);
          if (!call || call.resolved || call.committed || drained) return fail();
          const resolved = resolvedData(raw, call);
          await persist('resolved', { identity: call.admission.identity, callId: raw.callId, resolved }); call.resolved = resolved;
        }),
        commit: (receipt: HostRuntimeToolCommit) => receive(() => {
          const { resolvedDispatch, ...fields } = properties(receipt, ['identity', 'callId', 'toolName', 'persistedMessageId', 'contentSha256', 'status', 'registeredCommitAck', 'resolvedDispatch', 'hitlCommit']);
          return { ...detached(fields), resolvedDispatch: resolvedDispatch === null ? null : captureResolved(resolvedDispatch) };
        }, async raw => {
          const actualIdentity = identityFor(raw.identity); const call = calls.get(raw.callId);
          if (!call || call.committed || drained || raw.toolName !== call.admission.toolName || !text(raw.persistedMessageId)
            || !['success', 'error', 'cancelled'].includes(raw.status) || !['acknowledged', 'not_registered'].includes(raw.registeredCommitAck)) return fail();
          const resolved = raw.resolvedDispatch === null ? null : resolvedData(raw.resolvedDispatch, call);
          // Resolution is a pre-entry diagnostic. Stop may cancel after it but
          // before entry; only cancellation can retain a null execution target.
          if (resolved === null ? raw.status !== 'cancelled' : !same(resolved, call.resolved)) return fail();
          const hitlCommit = detached(raw.hitlCommit);
          const approval = (resolved ?? call.resolved)?.approval as HostResolvedToolDispatch['approval'] | undefined;
          if (hitlCommit !== null) {
            properties(hitlCommit, ['requestId', 'claimedRevision', 'committedRevision', 'status', 'executionState', 'resultStatus']);
            if (!text(hitlCommit.requestId) || !positive(hitlCommit.claimedRevision) || raw.registeredCommitAck !== 'acknowledged'
              || !positive(hitlCommit.committedRevision) || hitlCommit.committedRevision <= hitlCommit.claimedRevision
              || hitlCommit.status !== 'approved' || hitlCommit.executionState !== 'tool_result_committed' || hitlCommit.resultStatus !== raw.status) return fail();
          }
          if (approval?.kind === 'durable_confirmation') {
            if (!hitlCommit || hitlCommit.requestId !== approval.requestId || hitlCommit.claimedRevision !== approval.claimedRevision) return fail();
          } else if (hitlCommit !== null && (resolved !== null || call.resolved !== null || raw.status !== 'cancelled')) return fail();
          // A claimed confirmation may commit cancellation BEFORE executor entry.
          // Preserve its actual receipt, but null resolved target grants no authority.
          const locator = { messageId: raw.persistedMessageId, sessionId: actualIdentity.sessionId, turnId: actualIdentity.turnId,
            promptMessageId: actualIdentity.promptMessageId, toolCallId: raw.callId, role: 'tool_result' as const };
          const result = await this.ports.durableReader.readToolResultExact(locator); await guard();
          if (!result || result.contentSha256 !== raw.contentSha256 || !same(locator, { messageId: result.messageId, sessionId: result.sessionId,
            turnId: result.turnId, promptMessageId: result.promptMessageId, toolCallId: result.toolCallId, role: result.role })) return fail();
          const readback = async () => { const current = await this.ports.durableReader.readToolResultExact(locator); if (!current || !same(current, result)) return fail(); };
          await persist('committed', { identity: actualIdentity, callId: raw.callId, requestedName: raw.toolName, sequence: call.sequence,
            argsSha256: call.argsSha256, resolved, status: raw.status, registeredCommitAck: raw.registeredCommitAck, hitlCommit,
            result: { ...locator, contentSha256: result.contentSha256, contentUtf8Bytes: result.contentUtf8Bytes, createdAt: result.createdAt } }, (next, id) => {
            return { ...next, provenance: { ...next.provenance, checkpoint: { ...next.provenance.checkpoint,
              commits: [...next.provenance.checkpoint.commits,
                { callId: raw.callId, sequence: call.sequence, commitCheckpointId: id, resultMessageId: raw.persistedMessageId, status: raw.status }] } } };
          }, readback); call.committed = true;
        }),
        drain: (raw: HostRuntimeReceiptIdentity) => {
          if (admissionClosed) { poisoned = true; return Promise.reject(new Error('GOAL_RECEIPT_FAILED')); }
          admissionClosed = true; // Synchronous: no admission can race the first await.
          return receive(() => detached(raw), async snapshot => {
            const actual = identityFor(snapshot);
            if ([...calls.values()].some(call => !call.committed)) return fail();
            await persist('drained', { identity: actual, admittedCount: calls.size, committedCount: calls.size }); drained = true;
          });
        },
        journalComplete: (raw: Parameters<HostRuntimeReceiptObserver['journalComplete']>[0], completed: Parameters<HostRuntimeReceiptObserver['journalComplete']>[1]) => receive(() => {
          const actual = detached(raw); properties(completed);
          if (completed.id !== actual.runId || completed.sessionId !== actual.sessionId || completed.turnId !== actual.turnId
            || completed.status !== 'completed' || completed.phase !== 'completed' || !positive(completed.revision)
            || !completed.outcome || !text(properties(completed.outcome).messageId)) return fail();
          const locator = { chatRunId: actual.runId, sessionId: actual.sessionId, turnId: actual.turnId, revision: completed.revision,
            promptMessageId: actual.promptMessageId, terminalMessageId: completed.outcome.messageId! };
          return { actual, locator };
        }, async ({ actual, locator }) => {
          identityFor(actual); if (!drained || journalVerified) return fail();
          const journal = await this.ports.durableReader.readCompletedRunExact(locator); await guard();
          if (!journal || !same(locator, { chatRunId: journal.chatRunId, sessionId: journal.sessionId, turnId: journal.turnId, revision: journal.revision,
            promptMessageId: journal.promptMessageId, terminalMessageId: journal.terminalMessageId })) return fail();
          const readback = async () => { const current = await this.ports.durableReader.readCompletedRunExact(locator); if (!current || !same(current, journal)) return fail(); };
          await persist('journal_verified', { identity: actual, journal: detached(journal) }, undefined, readback); journalVerified = true;
        }),
      });
    } catch { return fail(); }
  }
}
