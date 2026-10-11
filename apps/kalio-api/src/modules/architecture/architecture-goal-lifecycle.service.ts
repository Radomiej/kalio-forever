import type { ArchitectureGoalSourceV1 } from '@kalio/types';
import { ArchitectureGoalRepository, type ArchitectureGoalState } from './architecture-goal.repository';
import { appendGoalSource, createGoalPacket, type GoalSourceLocator } from './architecture-goal-source';

export interface ArchitectureGoalSourceReadPort {
  read(locator: GoalSourceLocator): Promise<ArchitectureGoalSourceV1 | null>;
}

const nonempty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;

/** Parent module supplies the chat-owned source port; no chat imports or direct database access. */
export class ArchitectureGoalLifecycleService {
  constructor(
    private readonly repository: ArchitectureGoalRepository,
    private readonly sources: ArchitectureGoalSourceReadPort,
  ) {}

  async create(runId: string, rootSessionId: string, locator: GoalSourceLocator): Promise<ArchitectureGoalState> {
    this.assertIdentity(runId, rootSessionId);
    const source = await this.readSource(locator);
    const packet = createGoalPacket(source);
    const now = Date.now(); // Storage metadata only; source timestamp remains the persisted message timestamp.
    return this.repository.create({ runId, rootSessionId, packet, createdAt: now, updatedAt: now });
  }

  async append(runId: string, rootSessionId: string, locator: GoalSourceLocator, expectedRevision: number): Promise<ArchitectureGoalState> {
    this.assertIdentity(runId, rootSessionId);
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) throw new Error('GOAL_STATE_CONFLICT');
    const source = await this.readSource(locator);
    // Read after the asynchronous admission lookup: never operate on a pre-await revision snapshot.
    const state = this.hydrate(runId, rootSessionId, true)!;
    if (state.stateRevision !== expectedRevision) throw new Error('GOAL_STATE_CONFLICT');
    if (source.sessionId !== state.packet.original.sessionId) throw new Error('GOAL_SOURCE_INVALID.');
    let packet;
    try {
      packet = appendGoalSource(state.packet, source);
    } catch {
      throw new Error('GOAL_SOURCE_INVALID.');
    }
    if (packet.version === state.packet.version) return state;
    return this.repository.compareAndSwap(runId, expectedRevision, {
      rootSessionId, packet, updatedAt: Math.max(Date.now(), state.updatedAt),
    });
  }

  hydrate(runId: string, rootSessionId: string, goalRequired: boolean): ArchitectureGoalState | null {
    this.assertIdentity(runId, rootSessionId);
    if (typeof goalRequired !== 'boolean') throw new Error('GOAL_STATE_INVALID');
    const state = this.repository.load(runId, rootSessionId);
    if (!state && goalRequired) throw new Error('GOAL_STATE_MISSING.');
    return state;
  }

  private assertIdentity(runId: string, rootSessionId: string): void {
    if (!nonempty(runId) || !nonempty(rootSessionId)) throw new Error('GOAL_STATE_INVALID');
  }

  private async readSource(locator: GoalSourceLocator): Promise<ArchitectureGoalSourceV1> {
    if (!locator || !nonempty(locator.sessionId) || !nonempty(locator.messageId) || !nonempty(locator.turnId)) {
      throw new Error('GOAL_SOURCE_INVALID.');
    }
    let source: ArchitectureGoalSourceV1 | null;
    try {
      source = await this.sources.read(locator);
    } catch {
      throw new Error('GOAL_SOURCE_READ_ERROR.');
    }
    if (!source || source.messageId !== locator.messageId || source.sessionId !== locator.sessionId
      || source.turnId !== locator.turnId) throw new Error('GOAL_SOURCE_INVALID.');
    try {
      // The chat-owned port enforces role=user in storage. Validate/copy its source without inventing a ChatMessage.
      return createGoalPacket(source).original;
    } catch {
      throw new Error('GOAL_SOURCE_INVALID.');
    }
  }
}
