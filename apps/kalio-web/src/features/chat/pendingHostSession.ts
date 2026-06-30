import type { ChatSession } from '@kalio/types';

const PENDING_HOST_SESSION_PREFIX = 'pending-host-session:';
const pendingHostSessionIds = new Set<string>();

interface CreatePendingHostSessionParams {
  personaId: string;
  title?: string;
  runtimeContext?: ChatSession['runtimeContext'];
  now?: number;
}

export function isPendingHostSessionId(sessionId: string | null | undefined): boolean {
  return typeof sessionId === 'string' && pendingHostSessionIds.has(sessionId);
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
  const id = `${PENDING_HOST_SESSION_PREFIX}${crypto.randomUUID()}`;
  pendingHostSessionIds.add(id);
  return {
    id,
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
