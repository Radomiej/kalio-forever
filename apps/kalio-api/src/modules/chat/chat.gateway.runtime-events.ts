import type { SocketEvents } from '@kalio/types';
import type { Socket } from 'socket.io';
import type { SessionsService } from './sessions.service';
import { getSocketEventSessionId } from './chat.gateway.event-routing';

export function enqueueSessionEvent(queue: Promise<void>, task: () => Promise<void>, logger: Pick<Console, 'warn'>): Promise<void> {
  return queue.catch((error: unknown) => logger.warn(`Session lifecycle queue recovered after previous failure: ${error instanceof Error ? error.message : String(error)}`))
    .then(task).catch((error: unknown) => logger.warn(`Session event relay failed: ${String(error)}`));
}

/** Resolve the entire durable chain before selecting any recipient. Never grant socket ownership. */
export async function emitRuntimeEventToSubscribers<K extends keyof SocketEvents>(input: {
  event: K;
  payload: SocketEvents[K];
  clients: Map<string, Socket>;
  sessionSubscribers: Map<string, Set<string>>;
  sessionsService: Pick<SessionsService, 'get'>;
  logger: Pick<Console, 'warn'>;
  signal?: AbortSignal;
}): Promise<void> {
  if (input.signal?.aborted) return;
  // SessionsService already publishes these through the lifecycle channel.
  if (input.event === 'session:created' || input.event === 'session:updated') return;
  const sessionId = getSocketEventSessionId(input.payload);
  if (!sessionId?.trim()) {
    input.logger.warn(`Runtime event ${input.event} dropped: missing session identity`);
    return;
  }
  const ancestors: string[] = [];
  const visited = new Set<string>();
  let current: string | undefined = sessionId;
  try {
    while (current) {
      if (visited.has(current)) throw new Error('cyclic session ancestry');
      visited.add(current);
      const session = await input.sessionsService.get(current);
      if (input.signal?.aborted) return;
      if (!session || session.id !== current) throw new Error('unresolved session identity');
      ancestors.push(current);
      if (session.parentSessionId !== undefined && !session.parentSessionId.trim()) {
        throw new Error('invalid parent identity');
      }
      current = session.parentSessionId;
    }
  } catch (error: unknown) {
    input.logger.warn(`Runtime event ${input.event} dropped for session=${sessionId}: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }
  const recipients = new Set<string>();
  for (const ancestor of ancestors) {
    input.sessionSubscribers.get(ancestor)?.forEach((socketId) => recipients.add(socketId));
  }
  for (const socketId of recipients) {
    if (input.signal?.aborted) return;
    input.clients.get(socketId)?.emit(input.event, input.payload);
  }
}
