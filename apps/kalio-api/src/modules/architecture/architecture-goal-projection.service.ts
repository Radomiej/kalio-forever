import type { ArchitectureGoalCompletionPolicyV1, ArchitectureGoalCriterionV1, ArchitectureRun } from '@kalio/types';
import type { ArchitectureGoalLifecycleService } from './architecture-goal-lifecycle.service';
import type { ArchitectureGoalAuditService } from './architecture-goal-audit.service';
import type { ArchitectureGoalReviewService, GoalProjectionReviewResult } from './architecture-goal-review.service';
import type { ArchitectureGoalRepository, ArchitectureGoalState } from './architecture-goal.repository';
import { acceptGoalProjection, goalProjectionPolicyTargets, prepareGoalProjection } from './architecture-goal-projection';

export type HostGoalPolicyFactory = (active: readonly ArchitectureGoalCriterionV1[]) => ArchitectureGoalCompletionPolicyV1;
export type GoalProjectionStateResult =
  | { status: 'accepted'; state: ArchitectureGoalState }
  | { status: 'rejected'; state: ArchitectureGoalState }
  | { status: 'needs_user'; reason: Extract<GoalProjectionReviewResult, { status: 'needs_user' }>['reason']; state: ArchitectureGoalState };

const nonempty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;

export class ArchitectureGoalProjectionService {
  constructor(
    private readonly lifecycle: Pick<ArchitectureGoalLifecycleService, 'hydrate'>,
    private readonly repository: Pick<ArchitectureGoalRepository, 'load' | 'compareAndSwap'>,
    private readonly goalAudit: Pick<ArchitectureGoalAuditService, 'persistRequired'>,
    private readonly reviewer: Pick<ArchitectureGoalReviewService, 'review'>,
  ) {}

  /** The host alone supplies policyFactory. Worker JSON is only an untrusted projection proposal. */
  async project(run: ArchitectureRun, raw: unknown, expectedRevision: number,
    hostPolicyFactory: HostGoalPolicyFactory, signal?: AbortSignal): Promise<GoalProjectionStateResult> {
    try {
      signal?.throwIfAborted();
      if (!nonempty(run.id) || !nonempty(run.rootSessionId) || !nonempty(run.schemaId)
        || !Number.isSafeInteger(expectedRevision) || expectedRevision < 1 || typeof hostPolicyFactory !== 'function') {
        throw new Error('Invalid projection identity.');
      }
      const identity = { id: run.id, rootSessionId: run.rootSessionId, schemaId: run.schemaId };
      const initial = this.lifecycle.hydrate(identity.id, identity.rootSessionId, true);
      if (!initial || initial.runId !== identity.id || initial.rootSessionId !== identity.rootSessionId
        || initial.stateRevision !== expectedRevision) throw new Error('Projection state conflict.');
      const proposal = prepareGoalProjection(initial.packet, raw);
      const targets = goalProjectionPolicyTargets(initial.packet, proposal);
      const targetIds = targets.map(target => target.id);
      const hostPolicy = structuredClone(hostPolicyFactory(structuredClone(targets)));
      assertPolicyShape(hostPolicy, targetIds);
      const packet = structuredClone(initial.packet);
      if (packet.projection.status !== 'pending') throw new Error('Projection state conflict.');
      packet.projection.proposal = structuredClone(proposal);
      signal?.throwIfAborted();
      const pending = this.repository.compareAndSwap(identity.id, expectedRevision, {
        rootSessionId: identity.rootSessionId, packet, updatedAt: Math.max(Date.now(), initial.updatedAt),
      });
      await this.goalAudit.persistRequired(identity, pending);
      signal?.throwIfAborted();
      const current = () => {
        const loaded = this.repository.load(identity.id, identity.rootSessionId);
        if (!loaded || loaded.runId !== identity.id || loaded.rootSessionId !== identity.rootSessionId
          || loaded.stateRevision !== pending.stateRevision || loaded.packet.version !== pending.packet.version
          || loaded.packet.sourceFingerprint !== pending.packet.sourceFingerprint
          || loaded.packet.projection.status !== 'pending'
          || loaded.packet.projection.proposal?.proposalFingerprint !== proposal.proposalFingerprint) {
          throw new Error('Projection state conflict.');
        }
        return loaded;
      };
      const beforeReview = current();
      const review = await this.reviewer.review(structuredClone(beforeReview.packet), structuredClone(proposal), signal);
      signal?.throwIfAborted();
      const reviewed = current();
      if (review.status === 'rejected') return { status: 'rejected', state: structuredClone(reviewed) };
      if (review.status === 'needs_user') return { status: 'needs_user', reason: review.reason, state: structuredClone(reviewed) };
      if (review.status !== 'accepted') throw new Error('Invalid projection review.');
      // Only the real review result may supply acceptance authorization; no synthetic binding validation.
      const acceptedPacket = acceptGoalProjection(reviewed.packet, proposal, hostPolicy, review.binding);
      signal?.throwIfAborted();
      const accepted = this.repository.compareAndSwap(identity.id, reviewed.stateRevision, {
        rootSessionId: identity.rootSessionId, packet: acceptedPacket, updatedAt: Math.max(Date.now(), reviewed.updatedAt),
      });
      // Accepted storage without this ACK is an incomplete protocol state, not an execution receipt.
      await this.goalAudit.persistRequired(identity, accepted);
      signal?.throwIfAborted();
      return { status: 'accepted', state: structuredClone(accepted) };
    } catch {
      throw new Error('GOAL_PROJECTION_FAILED');
    }
  }
}

/** Validate what is possible before CAS. Semantic policy validation remains in acceptGoalProjection. */
function assertPolicyShape(policy: ArchitectureGoalCompletionPolicyV1, targetIds: readonly string[]): void {
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)
    || Object.keys(policy).length !== 1 || !Object.hasOwn(policy, 'requiredEvidenceKindsByCriterion')) {
    throw new Error('Invalid host policy.');
  }
  const requirements = policy.requiredEvidenceKindsByCriterion;
  if (!requirements || typeof requirements !== 'object' || Array.isArray(requirements)
    || Object.keys(requirements).length !== targetIds.length
    || targetIds.some(id => !Object.hasOwn(requirements, id) || !Array.isArray(requirements[id])
      || !requirements[id]!.length || requirements[id]!.some(kind => !nonempty(kind))
      || new Set(requirements[id]).size !== requirements[id]!.length)) {
    throw new Error('Invalid host policy.');
  }
}
