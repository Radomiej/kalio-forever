import type { Socket } from 'socket.io';
import type { SocketEvents } from '@kalio/types';
import type { SessionsService } from './sessions.service';

type SessionLifecycleEvent = 'session:created' | 'session:updated';
type LifecycleLogger = Pick<Console, 'warn'>;

export async function emitSessionLifecycleEventToSubscribers<K extends SessionLifecycleEvent>({
  event,
  payload,
  clients,
  sessionSubscribers,
  sessionsService,
  logger,
}: {
  event: K;
  payload: SocketEvents[K] & { id: string; parentSessionId?: string };
  clients: Map<string, Socket>;
  sessionSubscribers: Map<string, Set<string>>;
  sessionsService: Pick<SessionsService, 'get'>;
  logger: LifecycleLogger;
}): Promise<void> {
  const socketIds = await collectLifecycleSubscriberSocketIds({
    sessionId: payload.id,
    parentSessionId: payload.parentSessionId,
    sessionSubscribers,
    sessionsService,
    logger,
  });
  socketIds.forEach((socketId) => {
    clients.get(socketId)?.emit(event, payload);
  });
}

async function collectLifecycleSubscriberSocketIds({
  sessionId,
  parentSessionId,
  sessionSubscribers,
  sessionsService,
  logger,
}: {
  sessionId: string;
  parentSessionId: string | undefined;
  sessionSubscribers: Map<string, Set<string>>;
  sessionsService: Pick<SessionsService, 'get'>;
  logger: LifecycleLogger;
}): Promise<Set<string>> {
  const socketIds = new Set<string>();
  const visited = new Set<string>([sessionId]);
  addLifecycleSubscriberSocketIds(sessionSubscribers, sessionId, socketIds);

  let currentParentSessionId = parentSessionId;
  while (currentParentSessionId && !visited.has(currentParentSessionId)) {
    visited.add(currentParentSessionId);
    addLifecycleSubscriberSocketIds(sessionSubscribers, currentParentSessionId, socketIds);
    try {
      const parentSession = await sessionsService.get(currentParentSessionId);
      currentParentSessionId = parentSession.parentSessionId;
    } catch (error) {
      logger.warn(
        `Failed to resolve ancestor sessions for lifecycle event session=${sessionId} parent=${currentParentSessionId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      break;
    }
  }

  return socketIds;
}

function addLifecycleSubscriberSocketIds(
  sessionSubscribers: Map<string, Set<string>>,
  sessionId: string,
  socketIds: Set<string>,
): void {
  sessionSubscribers.get(sessionId)?.forEach((socketId) => socketIds.add(socketId));
}
