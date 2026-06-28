import type { ChatSession } from '@kalio/types';

const PENDING_HOST_SESSION_PREFIX = 'pending-host-session:';

interface CreatePendingHostSessionParams {
  personaId: string;
  title?: string;
  runtimeContext?: ChatSession['runtimeContext'];
  now?: number;
}

export function isPendingHostSessionId(sessionId: string | null | undefined): boolean {
  // TODO: legacy fallback for local placeholder sessions created before runtimeContext.pendingHostSession.
  return typeof sessionId === 'string' && sessionId.startsWith(PENDING_HOST_SESSION_PREFIX);
}

export function isPendingHostSession(session: ChatSession | null | undefined): boolean {
  if (!session) {
    return false;
  }
  if (session.runtimeContext?.pendingHostSession === true) {
    return true;
  }
  return isPendingHostSessionId(session.id);
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
    runtimeContext: {
      ...(runtimeContext ?? { runtimeKind: 'chat' as const }),
      runtimeKind: runtimeContext?.runtimeKind ?? 'chat',
      pendingHostSession: true,
    },
    createdAt: now,
    updatedAt: now,
  };
}
