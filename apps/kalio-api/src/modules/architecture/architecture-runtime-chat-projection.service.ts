import { Injectable, Logger } from '@nestjs/common';
import type {
  ArchitectureChatProjection,
  ArchitectureExecutionEvent,
  ArchitectureRun,
  ArchitectureSchema,
  ChatMessage,
} from '@kalio/types';
import { SessionsService } from '../chat/sessions.service';
import { SessionManagerService } from '../chat/session-manager.service';
import { buildArchitectureParentChatMessages } from './architecture-parent-chat-projection';
import { buildArchitectureRuntimeChatProjection } from './architecture-runtime-chat-projection.utils';
import { getArchitectureParentSessionId } from './architecture-session-context';

@Injectable()
export class ArchitectureRuntimeChatProjectionService {
  private readonly logger = new Logger(ArchitectureRuntimeChatProjectionService.name);

  constructor(
    private readonly sessions: SessionsService,
    private readonly sessionManager: SessionManagerService,
  ) {}

  build(runId: string, events: ArchitectureExecutionEvent[]): ArchitectureChatProjection {
    return buildArchitectureRuntimeChatProjection(runId, events);
  }

  async persistParent(
    schema: ArchitectureSchema,
    run: ArchitectureRun,
    events: ArchitectureExecutionEvent[],
  ): Promise<void> {
    const projectionSessionId = getArchitectureParentSessionId(run.context) ?? run.rootSessionId;
    if (!projectionSessionId) {
      return;
    }
    let targetSessionId = projectionSessionId;
    let existingMessages: ChatMessage[];
    try {
      existingMessages = await this.sessions.getMessages(targetSessionId);
    } catch (error) {
      if (!run.rootSessionId || targetSessionId === run.rootSessionId) {
        throw error;
      }
      targetSessionId = run.rootSessionId;
      existingMessages = await this.sessions.getMessages(targetSessionId);
    }
    const messages = buildArchitectureParentChatMessages(schema, run, targetSessionId, events, Date.now());
    const existingMessageIds = new Set(existingMessages.map((message) => message.id));
    await Promise.all(
      messages
        .filter((message) => !existingMessageIds.has(message.id))
        .map((message) => this.sessionManager.persistMessage(message)),
    );
  }

  async persistParentSafely(
    schema: ArchitectureSchema,
    run: ArchitectureRun,
    events: ArchitectureExecutionEvent[],
  ): Promise<void> {
    try {
      await this.persistParent(schema, run, events);
    } catch (error) {
      this.logger.warn(
        `Failed to persist architecture failure projection for run ${run.id}: ${this.errorMessage(error)}`,
      );
    }
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
