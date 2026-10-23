import { Inject, Injectable } from '@nestjs/common';
import { ArchitectureGoalRepository, type ArchitectureGoalState } from './architecture-goal.repository';
import { inspectGoalCompletion, type GoalCompletionCandidate } from './architecture-goal-completion';
import { cloneGoalCompletionJson, validateGoalCompletionState, type GoalCompletionScope } from './architecture-goal-completion-state';
import type { GoalCompletionReviewSnapshot, GoalCompletionReviewHostPort } from './architecture-goal-completion-review.service';

export const GOAL_COMPLETION_REVIEW_INVENTORY = 'GOAL_COMPLETION_REVIEW_INVENTORY';
export interface VerifiedGoalCompletionReviewInventory extends GoalCompletionScope {
  readonly stateRevision: number;
  readonly goalFingerprint: string;
  readonly criterionEvidenceIds: GoalCompletionCandidate['criterionEvidenceIds'];
}
export interface GoalCompletionReviewInventoryPort {
  /** Resolve real durable dispatch/event/index/child records and host-approved
   * criterion applicability. No kind-only matching, worker claims or receipt fallback.
   * Empty refs preserve incomplete work; returning this shape alone proves no trust. */
  verifyAndBind(state: ArchitectureGoalState, signal?: AbortSignal): Promise<VerifiedGoalCompletionReviewInventory>;
}

function fail(code: string): never { throw new Error(code); }
function text(value: unknown): value is string { return typeof value === 'string' && value.trim().length > 0; }
/** Equality of strict cloned JSON only, not a new canonical fingerprint. */
function identity(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : item);
}

@Injectable()
export class ArchitectureGoalCompletionReviewHostService implements GoalCompletionReviewHostPort {
  constructor(private readonly repository: ArchitectureGoalRepository,
    @Inject(GOAL_COMPLETION_REVIEW_INVENTORY) private readonly verifier: GoalCompletionReviewInventoryPort) {}

  async readCurrent(runId: string, signal?: AbortSignal): Promise<GoalCompletionReviewSnapshot> {
    signal?.throwIfAborted();
    if (!text(runId)) return fail('GOAL_REVIEW_HOST_INVALID_INPUT');
    if (!this.verifier || typeof this.verifier.verifyAndBind !== 'function') return fail('GOAL_REVIEW_HOST_UNAVAILABLE');
    const state = this.read(runId);
    let returned: VerifiedGoalCompletionReviewInventory;
    try { returned = await this.verifier.verifyAndBind(cloneGoalCompletionJson(state), signal); }
    catch { signal?.throwIfAborted(); return fail('GOAL_REVIEW_HOST_VERIFICATION_FAILED'); }
    signal?.throwIfAborted();
    let snapshot: GoalCompletionReviewSnapshot;
    try {
      const verified = cloneGoalCompletionJson(returned);
      const keys = ['runId', 'rootSessionId', 'stateRevision', 'goalVersion', 'sourceFingerprint', 'goalFingerprint', 'criterionEvidenceIds'];
      const inventory = state.evidenceInventory;
      if (!verified || typeof verified !== 'object' || Array.isArray(verified)
        || Reflect.ownKeys(verified).length !== keys.length || !keys.every(key => Object.hasOwn(verified, key))
        || inventory?.schemaVersion !== 2 || state.packet.projection.status !== 'accepted'
        || verified.runId !== state.runId || verified.rootSessionId !== state.rootSessionId
        || verified.stateRevision !== state.stateRevision || verified.goalVersion !== state.packet.version
        || verified.sourceFingerprint !== state.packet.sourceFingerprint
        || verified.goalFingerprint !== state.packet.projection.snapshot.goalFingerprint) return fail('GOAL_REVIEW_HOST_BINDING_INVALID');
      const inspected = inspectGoalCompletion(state.packet, verified.criterionEvidenceIds, inventory.host,
        { runId: state.runId, rootSessionId: state.rootSessionId, provenance: inventory.provenance });
      snapshot = { runId: state.runId, rootSessionId: state.rootSessionId, stateRevision: state.stateRevision,
        packet: state.packet, host: inventory.host, provenance: inventory.provenance,
        criterionEvidenceIds: inspected.criterionEvidenceIds };
    } catch { return fail('GOAL_REVIEW_HOST_BINDING_INVALID'); }
    try {
      const current = this.read(runId);
      if (identity(current) !== identity(state)) return fail('GOAL_REVIEW_HOST_STATE_STALE');
    } catch { return fail('GOAL_REVIEW_HOST_STATE_STALE'); }
    signal?.throwIfAborted();
    return cloneGoalCompletionJson(snapshot);
  }

  private read(runId: string): ArchitectureGoalState {
    try {
      const loaded = this.repository.load(runId);
      if (!loaded) return fail('GOAL_REVIEW_HOST_STATE_INVALID');
      const state = cloneGoalCompletionJson(loaded);
      if (state.runId !== runId || !text(state.rootSessionId) || state.packet.projection.status !== 'accepted'
        || state.evidenceInventory?.schemaVersion !== 2) return fail('GOAL_REVIEW_HOST_STATE_INVALID');
      validateGoalCompletionState(state, state.evidenceInventory, state.completionAuthorization);
      return state;
    } catch { return fail('GOAL_REVIEW_HOST_STATE_INVALID'); }
  }
}
