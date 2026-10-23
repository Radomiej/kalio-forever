import type { ArchitectureRun } from '@kalio/types';
import type { ArchitectureGoalLifecycleService } from './architecture-goal-lifecycle.service';
import type { ArchitectureGoalRepository, ArchitectureGoalState } from './architecture-goal.repository';
import type { ArchitectureGoalAuditService } from './architecture-goal-audit.service';
import { prepareGoalProjection } from './architecture-goal-projection';

/** Persists the worker proposal before the judge phase; never authorizes implementation. */
export class ArchitectureGoalProposalService {
  constructor(
    private readonly lifecycle: Pick<ArchitectureGoalLifecycleService, 'hydrate'>,
    private readonly repository: Pick<ArchitectureGoalRepository, 'load' | 'compareAndSwap'>,
    private readonly audit: Pick<ArchitectureGoalAuditService, 'persistRequired'>,
  ) {}

  async record(run: Pick<ArchitectureRun, 'id' | 'rootSessionId' | 'schemaId'>, raw: unknown,
    expectedRevision: number, signal?: AbortSignal): Promise<ArchitectureGoalState> {
    try {
      signal?.throwIfAborted();
      const identity = structuredClone(run);
      if (!identity.id?.trim() || !identity.rootSessionId?.trim() || !identity.schemaId?.trim()
        || !Number.isSafeInteger(expectedRevision) || expectedRevision < 1) throw new Error('Invalid identity.');
      const initial = this.lifecycle.hydrate(identity.id, identity.rootSessionId, true);
      if (!initial || initial.runId !== identity.id || initial.rootSessionId !== identity.rootSessionId
        || initial.stateRevision !== expectedRevision || initial.packet.projection.status !== 'pending') {
        throw new Error('Stale proposal.');
      }
      const packet = structuredClone(initial.packet);
      const proposal = prepareGoalProjection(packet, raw);
      if (packet.projection.status !== 'pending') throw new Error('Invalid projection.');
      packet.projection.proposal = proposal;
      signal?.throwIfAborted();
      const saved = this.repository.compareAndSwap(identity.id, expectedRevision, {
        rootSessionId: identity.rootSessionId, packet, updatedAt: Math.max(Date.now(), initial.updatedAt),
      });
      await this.audit.persistRequired(identity, saved);
      signal?.throwIfAborted();
      const current = this.repository.load(identity.id, identity.rootSessionId);
      if (!current || current.runId !== identity.id || current.rootSessionId !== identity.rootSessionId
        || current.stateRevision !== saved.stateRevision || current.packet.version !== packet.version
        || current.packet.sourceFingerprint !== packet.sourceFingerprint
        || current.packet.projection.status !== 'pending'
        || current.packet.projection.proposal?.proposalFingerprint !== proposal.proposalFingerprint) {
        throw new Error('Stale proposal.');
      }
      return structuredClone(current);
    } catch {
      throw new Error('GOAL_PROPOSAL_FAILED');
    }
  }
}
