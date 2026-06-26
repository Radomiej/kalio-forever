import type { ChatSession } from '@kalio/types';

const PENDING_HOST_SESSION_PREFIX = 'pending-host-session:';

interface CreatePendingHostSessionParams {
  personaId: string;
  title?: string;
  runtimeContext?: ChatSession['runtimeContext'];
  now?: number;
}

export function isPendingHostSessionId(sessionId: string | null | undefined): boolean {
  return typeof sessionId === 'string' && sessionId.startsWith(PENDING_HOST_SESSION_PREFIX);
}

export function createPendingHostSession({
  personaId,
  title = 'New Chat',
  runtimeContext,
  now = Date.now(),
}: CreatePendingHostSessionParams): ChatSession {
  return {
    id: `${PENDING_HOST_SESSION_PREFIX}${crypto.randomUUID()}`,
    personaId,
    title,
    ...(runtimeContext ? { runtimeContext } : {}),
    createdAt: now,
    updatedAt: now,
  };
}
