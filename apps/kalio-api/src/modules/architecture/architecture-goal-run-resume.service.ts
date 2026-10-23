import type { ArchitectureRun } from '@kalio/types';
import type { ArchitectureGoalLifecycleService } from './architecture-goal-lifecycle.service';
import type { ArchitectureGoalAuditService } from './architecture-goal-audit.service';
import { appendGoalSource, type GoalSourceLocator } from './architecture-goal-source';

export interface ArchitectureGoalResumeInput {
  source?: GoalSourceLocator;
  expectedRevision?: number;
  input?: string;
}

const nonempty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;

export class ArchitectureGoalRunResumeService {
  constructor(
    private readonly lifecycle: Pick<ArchitectureGoalLifecycleService, 'hydrate' | 'append'>,
    private readonly goalAudit: Pick<ArchitectureGoalAuditService, 'persistRequired'>,
  ) {}

  /** The host must authorize the persisted source locator; raw input is never an admitted goal source. */
  async resume(run: ArchitectureRun, input: ArchitectureGoalResumeInput): Promise<ArchitectureRun> {
    const markerPresent = !!run.context && Object.hasOwn(run.context, 'goalProtocol');
    if (markerPresent && run.context!['goalProtocol'] !== 1) throw new Error('GOAL_RESUME_PROTOCOL_INVALID');
    if (!markerPresent && run.goalPacket === undefined) {
      try { return structuredClone(run); } catch { throw new Error('GOAL_RESUME_FAILED'); }
    }
    if (!nonempty(run.id) || !nonempty(run.rootSessionId) || !nonempty(run.schemaId)) {
      throw new Error('GOAL_RESUME_IDENTITY_INVALID');
    }
    if (input.input !== undefined && typeof input.input !== 'string') throw new Error('GOAL_RESUME_INPUT_INVALID');
    if (nonempty(input.input) && !input.source) throw new Error('GOAL_RESUME_SOURCE_REQUIRED');
    if (input.source && (!Number.isSafeInteger(input.expectedRevision) || (input.expectedRevision ?? 0) < 1)) {
      throw new Error('GOAL_RESUME_REVISION_REQUIRED');
    }
    const identity = { id: run.id, rootSessionId: run.rootSessionId, schemaId: run.schemaId };
    try {
      let state = this.lifecycle.hydrate(identity.id, identity.rootSessionId, true);
      if (!state) throw new Error('GOAL_RESUME_STATE_MISSING');
      if (input.source) {
        state = await this.lifecycle.append(identity.id, identity.rootSessionId, input.source, input.expectedRevision!);
      }
      if (state.runId !== identity.id || state.rootSessionId !== identity.rootSessionId) {
        throw new Error('GOAL_RESUME_STATE_INVALID');
      }
      // Validate current durable packet and detach every nested reference before audit/return.
      const packet = appendGoalSource(state.packet, state.packet.original);
      const resumed = structuredClone(run);
      await this.goalAudit.persistRequired(identity, state);
      resumed.goalPacket = packet;
      resumed.prompt = packet.original.content;
      return resumed;
    } catch {
      // No provider/storage/audit exception text or raw canonical content escapes this boundary.
      throw new Error('GOAL_RESUME_FAILED');
    }
  }
}
