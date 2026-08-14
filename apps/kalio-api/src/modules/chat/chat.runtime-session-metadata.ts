import type { ChatSession } from '@kalio/types';
import type { SessionsService } from './sessions.service';

interface RuntimeSnapshotLogger {
  warn(message: string): void;
}

export async function safeLoadRuntimeSnapshotSessionMetadata(
  sessionId: string,
  sessionsService: Pick<SessionsService, 'get'>,
  logger: RuntimeSnapshotLogger | undefined,
): Promise<ChatSession | undefined> {
  try {
    return await sessionsService.get(sessionId);
  } catch (error) {
    logger?.warn(
      `Unable to load session metadata ${sessionId} for runtime snapshot: ${error instanceof Error ? error.message : String(error)}`,
    );
    return undefined;
  }
}
