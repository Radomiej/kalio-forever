import type { ChatSession } from '@kalio/types';
import { isPendingHostSessionId } from '../chat/pendingHostSession';

export function mergeSessionsPreservingLocal(current: ChatSession[], incoming: ChatSession[]): ChatSession[] {
  const currentById = new Map(current.map((session) => [session.id, session] as const));
  const incomingIds = new Set(incoming.map((session) => session.id));
  const pendingLocalSessions = current.filter((session) => (
    isPendingHostSessionId(session.id) && !incomingIds.has(session.id)
  ));

  return [
    ...pendingLocalSessions,
    ...incoming.map((session) => {
      const existing = currentById.get(session.id);
      if (!existing) {
        return session;
      }
      if (session.updatedAt < existing.updatedAt) {
        return existing;
      }
      return { ...existing, ...session };
    }),
  ];
}
