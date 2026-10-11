import type { ArchitectureRun } from '@kalio/types';
import type { ArchitectureGoalLifecycleService } from './architecture-goal-lifecycle.service';
import type { ArchitectureGoalAuditService } from './architecture-goal-audit.service';
import { appendGoalSource } from './architecture-goal-source';

const nonempty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;

/** Call only after the launch adapter has overwritten model identities with dispatcher-owned values. */
export class ArchitectureGoalRunAdmissionService {
  constructor(
    private readonly lifecycle: Pick<ArchitectureGoalLifecycleService, 'create'>,
    private readonly goalAudit: Pick<ArchitectureGoalAuditService, 'persistRequired'>,
  ) {}

  async attach(run: ArchitectureRun): Promise<void> {
    const context = run.context;
    if (!context || !Object.hasOwn(context, 'goalProtocol')) return;
    if (context['goalProtocol'] !== 1) throw new Error('GOAL_ADMISSION_PROTOCOL_INVALID');
    const sessionId = context['parentSessionId'];
    const messageId = context['promptMessageId'];
    const turnId = context['parentTurnId'];
    if (!nonempty(run.id) || !nonempty(run.rootSessionId) || !nonempty(run.schemaId)
      || !nonempty(sessionId) || !nonempty(messageId) || !nonempty(turnId)) {
      throw new Error('GOAL_ADMISSION_IDENTITY_INVALID');
    }
    const identity = { id: run.id, rootSessionId: run.rootSessionId, schemaId: run.schemaId };
    try {
      const state = await this.lifecycle.create(identity.id, identity.rootSessionId, { sessionId, messageId, turnId });
      const original = state.packet.original;
      if (state.runId !== identity.id || state.rootSessionId !== identity.rootSessionId
        || original.sessionId !== sessionId || original.messageId !== messageId || original.turnId !== turnId
        || state.packet.version !== 1 || state.stateRevision !== 1) {
        throw new Error('GOAL_ADMISSION_STATE_INVALID');
      }
      // An idempotent source append validates packet invariants and produces a fully isolated copy.
      const packet = appendGoalSource(state.packet, original);
      await this.goalAudit.persistRequired(identity, state);
      run.goalPacket = packet;
      run.prompt = packet.original.content;
    } catch {
      // Repository, audit and clone failures must never disclose canonical content or driver errors.
      throw new Error('GOAL_ADMISSION_FAILED');
    }
  }
}
