import { Inject, Injectable } from '@nestjs/common';
import type { ArchitectureRun } from '@kalio/types';
import { ArchitectureGoalRepository, type ArchitectureGoalState } from './architecture-goal.repository';
import { ArchitectureGoalCompletionReviewService, type GoalCompletionSelectionResult } from './architecture-goal-completion-review.service';
import { assertGoalCompletion, prepareGoalCompletion, type GoalCompletionBinding } from './architecture-goal-completion';
import { cloneGoalCompletionJson, validateGoalCompletionState, type GoalCompletionReceiptV2 } from './architecture-goal-completion-state';
import { assertGoalProjectionHistory } from './architecture-goal-projection';

type RunIdentity = Pick<ArchitectureRun, 'id' | 'rootSessionId' | 'schemaId'>;
export const GOAL_COMPLETION_AUTHORIZATION_HOST = 'GOAL_COMPLETION_AUTHORIZATION_HOST';
export interface GoalCompletionAuthorizationHostPort {
  /** Independently resolve trusted durable producer/event/index/child provenance.
   * Reject absent/incomplete/untrusted inventory; never accept worker assertions. */
  verifyDurableInventory(state: ArchitectureGoalState, signal?: AbortSignal): Promise<void>;
  /** Await logRequired(<runId>:goal-completion:<authorizedStateRevision>) with
   * exact run/root/schema/revision and binding metadata. Idempotent, fail closed.
   * Runtime MUST still serialize this ACK and terminal publication with its finalization barrier. */
  acknowledgeFinalizationRequired(run: RunIdentity, state: ArchitectureGoalState, signal?: AbortSignal): Promise<void>;
}
export type GoalCompletionAuthorizationResult =
  | { readonly status: 'authorized'; readonly authorizedStateRevision: number; readonly binding: Readonly<GoalCompletionBinding>;
      readonly checkpointId: string; readonly replayed: boolean }
  | Extract<GoalCompletionSelectionResult, { status: 'continue' | 'needs_user' }>;

function fail(code: string): never { throw new Error(code); }
function text(value: unknown): value is string { return typeof value === 'string' && value.trim().length > 0; }
function positive(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value > 0; }
/** Equality only on strict cloned JSON, not an independent fingerprint format. */
function identity(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : item);
}

@Injectable()
export class ArchitectureGoalCompletionAuthorizationService {
  constructor(private readonly repository: ArchitectureGoalRepository,
    private readonly review: ArchitectureGoalCompletionReviewService,
    @Inject(GOAL_COMPLETION_AUTHORIZATION_HOST) private readonly host: GoalCompletionAuthorizationHostPort) {}

  /** Recovery may repeat an existing receipt/ACK only. It must never fall through
   * to semantic review when a receipt disappears or source/inventory changes. */
  async verifyReplay(input: { run: RunIdentity; expectedState: ArchitectureGoalState; signal: AbortSignal }):
    Promise<Extract<GoalCompletionAuthorizationResult, { status: 'authorized' }>> {
    if (input.signal.aborted) return fail('GOAL_AUTH_REPLAY_ABORTED');
    let scope: RunIdentity;
    let expected: ArchitectureGoalState;
    try {
      scope = cloneGoalCompletionJson(input.run);
      expected = cloneGoalCompletionJson(input.expectedState);
      if (![scope.id, scope.rootSessionId, scope.schemaId].every(text)
        || !positive(expected.packet.version)) return fail('GOAL_AUTH_INVALID_INPUT');
    } catch { return fail('GOAL_AUTH_INVALID_INPUT'); }
    const version = expected.packet.version;
    const current = this.current(expected, scope, version);
    if (current.completionAuthorization?.schemaVersion !== 2) return fail('GOAL_AUTH_REPLAY_UNAVAILABLE');
    try {
      await this.verify(current, input.signal);
      if (input.signal.aborted) return fail('GOAL_AUTH_REPLAY_ABORTED');
      const checked = this.current(current, scope, version);
      const result = await this.acknowledge(scope, checked, version, true, input.signal);
      if (result.status !== 'authorized' || result.replayed !== true) return fail('GOAL_AUTH_REPLAY_UNAVAILABLE');
      return result;
    } catch (error) {
      if (input.signal.aborted) return fail('GOAL_AUTH_REPLAY_ABORTED');
      throw error;
    }
  }

  async authorize(run: RunIdentity, expectedGoalVersion: number, signal?: AbortSignal): Promise<GoalCompletionAuthorizationResult> {
    signal?.throwIfAborted();
    if (!run || !text(run.id) || !text(run.rootSessionId) || !text(run.schemaId) || !positive(expectedGoalVersion)) return fail('GOAL_AUTH_INVALID_INPUT');
    if (!this.host || typeof this.host.verifyDurableInventory !== 'function' || typeof this.host.acknowledgeFinalizationRequired !== 'function') {
      return fail('GOAL_AUTH_HOST_UNAVAILABLE');
    }
    const scope = Object.freeze({ id: run.id, rootSessionId: run.rootSessionId, schemaId: run.schemaId });
    const initial = this.read(scope, expectedGoalVersion);
    await this.verify(initial, signal);
    this.current(initial, scope, expectedGoalVersion);
    if (initial.completionAuthorization) return this.acknowledge(scope, initial, expectedGoalVersion, true, signal);

    let selected: GoalCompletionSelectionResult;
    try { selected = cloneGoalCompletionJson(await this.review.select(scope.id, scope.rootSessionId, expectedGoalVersion, signal)); }
    catch { signal?.throwIfAborted(); return fail('GOAL_AUTH_SELECTION_INVALID'); }
    signal?.throwIfAborted();
    if (selected.status === 'needs_user') return selected;
    const latest = this.current(initial, scope, expectedGoalVersion);
    if (selected.reviewedStateRevision !== latest.stateRevision || typeof selected.confidence !== 'number'
      || !Number.isFinite(selected.confidence) || selected.confidence < .95 || selected.confidence > 1) return fail('GOAL_AUTH_SELECTION_INVALID');
    if (selected.status === 'continue') {
      const projection = latest.packet.projection;
      if (projection.status !== 'accepted') return fail('GOAL_AUTH_SELECTION_INVALID');
      const superseded = new Set(projection.snapshot.criteria.flatMap(row => row.supersedes));
      if (!projection.snapshot.criteria.some(row => row.id === selected.criterionId && !superseded.has(row.id))) return fail('GOAL_AUTH_SELECTION_INVALID');
      return selected;
    }
    if (selected.status !== 'complete' || !latest.evidenceInventory) return fail('GOAL_AUTH_SELECTION_INVALID');
    await this.verify(latest, signal);
    const checked = this.current(latest, scope, expectedGoalVersion);
    let receipt: Omit<GoalCompletionReceiptV2, 'authorizedStateRevision'>;
    try {
      if (checked.evidenceInventory?.schemaVersion !== 2) return fail('GOAL_AUTH_SELECTION_INVALID');
      const provenanceInput = { runId: scope.id, rootSessionId: scope.rootSessionId, provenance: checked.evidenceInventory.provenance };
      const candidate = prepareGoalCompletion(checked.packet, selected.candidate.criterionEvidenceIds, checked.evidenceInventory.host, provenanceInput);
      if (identity(selected.candidate) !== identity(candidate) || identity(selected.binding) !== identity(candidate.binding)) return fail('GOAL_AUTH_SELECTION_INVALID');
      // Consistency check only; semantic authorization comes from the injected real selector,
      // durable provenance verifier, then repository CAS and required finalization ACK.
      assertGoalCompletion(checked.packet, candidate, checked.evidenceInventory.host, selected.callerBinding, provenanceInput);
      receipt = { schemaVersion: 2, runId: scope.id, rootSessionId: scope.rootSessionId, goalVersion: checked.packet.version,
        sourceFingerprint: checked.packet.sourceFingerprint, reviewedStateRevision: checked.stateRevision,
        inventoryStateRevision: checked.evidenceInventory.inventoryStateRevision, choice: 'complete', confidence: selected.confidence,
        binding: candidate.binding, criterionEvidenceIds: candidate.criterionEvidenceIds };
    } catch { return fail('GOAL_AUTH_SELECTION_INVALID'); }
    signal?.throwIfAborted();
    let authorized: ArchitectureGoalState;
    try {
      authorized = this.repository.authorizeCompletion(scope.id, checked.stateRevision, scope.rootSessionId, receipt,
        Math.max(Date.now(), checked.updatedAt));
    } catch (error) {
      if (error instanceof Error && error.message === 'GOAL_STATE_CONFLICT') return fail('GOAL_AUTH_STATE_STALE');
      return fail('GOAL_AUTH_PERSIST_FAILED');
    }
    return this.acknowledge(scope, authorized, expectedGoalVersion, false, signal);
  }

  private read(run: RunIdentity, version: number): ArchitectureGoalState {
    try {
      const loaded = this.repository.load(run.id, run.rootSessionId);
      if (!loaded) return fail('GOAL_AUTH_STATE_INVALID');
      const state = cloneGoalCompletionJson(loaded);
      if (state.runId !== run.id || state.rootSessionId !== run.rootSessionId || state.packet.version !== version) return fail('GOAL_AUTH_STATE_INVALID');
      assertGoalProjectionHistory(state.packet);
      validateGoalCompletionState(state, state.evidenceInventory, state.completionAuthorization);
      return state;
    } catch { return fail('GOAL_AUTH_STATE_INVALID'); }
  }

  private current(expected: ArchitectureGoalState, run: RunIdentity, version: number): ArchitectureGoalState {
    try {
      const state = this.read(run, version);
      if (identity(state) !== identity(expected)) return fail('GOAL_AUTH_STATE_STALE');
      return state;
    } catch { return fail('GOAL_AUTH_STATE_STALE'); }
  }

  private async verify(state: ArchitectureGoalState, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    // Valid legacy storage remains readable, but cannot enter live review or replay.
    if (state.evidenceInventory?.schemaVersion !== 2
      || (state.completionAuthorization !== null && state.completionAuthorization.schemaVersion !== 2)) return fail('GOAL_AUTH_PROVENANCE_FAILED');
    try { await this.host.verifyDurableInventory(cloneGoalCompletionJson(state), signal); }
    catch { signal?.throwIfAborted(); return fail('GOAL_AUTH_PROVENANCE_FAILED'); }
    signal?.throwIfAborted();
  }

  private async acknowledge(run: RunIdentity, state: ArchitectureGoalState, version: number, replayed: boolean,
    signal?: AbortSignal): Promise<GoalCompletionAuthorizationResult> {
    signal?.throwIfAborted();
    const beforeAck = this.current(state, run, version);
    if (beforeAck.evidenceInventory?.schemaVersion !== 2 || beforeAck.completionAuthorization?.schemaVersion !== 2) return fail('GOAL_AUTH_STATE_INVALID');
    try { await this.host.acknowledgeFinalizationRequired(run, cloneGoalCompletionJson(beforeAck), signal); }
    catch { signal?.throwIfAborted(); return fail('GOAL_AUTH_ACK_FAILED'); }
    signal?.throwIfAborted();
    const afterAck = this.current(beforeAck, run, version);
    const receipt = afterAck.completionAuthorization;
    if (afterAck.evidenceInventory?.schemaVersion !== 2 || receipt?.schemaVersion !== 2) return fail('GOAL_AUTH_STATE_STALE');
    return Object.freeze({ status: 'authorized', authorizedStateRevision: afterAck.stateRevision,
      binding: Object.freeze(cloneGoalCompletionJson(receipt.binding)), checkpointId: `${run.id}:goal-completion:${afterAck.stateRevision}`, replayed });
  }
}
