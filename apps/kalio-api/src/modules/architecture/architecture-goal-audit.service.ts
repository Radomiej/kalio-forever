import { Injectable, Optional } from '@nestjs/common';
import type { ArchitectureRun } from '@kalio/types';
import { AuditService } from '../chat/audit.service';
import type { ArchitectureGoalState } from './architecture-goal.repository';

@Injectable()
export class ArchitectureGoalAuditService {
  constructor(@Optional() private readonly audit?: AuditService) {}

  async persistRequired(run: Pick<ArchitectureRun, 'id' | 'rootSessionId' | 'schemaId'>,
    state: ArchitectureGoalState): Promise<void> {
    if (!run.rootSessionId || state.runId !== run.id || state.rootSessionId !== run.rootSessionId) {
      throw new Error('GOAL_AUDIT_STATE_MISMATCH');
    }
    if (!this.audit) throw new Error('GOAL_AUDIT_UNAVAILABLE');
    const packet = state.packet;
    try {
      await this.audit.logRequired(`${run.id}:goal-state:${state.stateRevision}`, {
        sessionId: run.rootSessionId,
        type: 'architecture_event',
        label: 'architecture_event:goal_protocol',
        data: {
          domain: 'architecture', kind: 'architecture_event', eventType: 'goal_protocol', schemaVersion: 1,
          runId: run.id, rootSessionId: run.rootSessionId, schemaId: run.schemaId,
          stateRevision: state.stateRevision, sourceVersion: packet.version,
          projectionStatus: packet.projection.status, sourceFingerprint: packet.sourceFingerprint,
          goalFingerprint: packet.projection.status === 'accepted' ? packet.projection.snapshot.goalFingerprint : null,
          sourceMessageIds: [packet.original.messageId, ...packet.updates.map(source => source.messageId)],
        },
      });
    } catch {
      // Required durability failures must propagate, without driver text or canonical content.
      throw new Error('GOAL_AUDIT_WRITE_FAILED');
    }
  }
}
