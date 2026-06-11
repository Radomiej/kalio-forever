import type { ChatSession } from '@kalio/types';

export function buildChildSessionsByParent(sessions: ChatSession[]): Map<string, ChatSession[]> {
  return sessions.reduce((acc, session) => {
    if (!session.parentSessionId) return acc;
    acc.set(session.parentSessionId, [...(acc.get(session.parentSessionId) ?? []), session]);
    return acc;
  }, new Map<string, ChatSession[]>());
}

export function countSessionDescendants(
  sessionId: string,
  childSessionsByParent: Map<string, ChatSession[]>,
  cache = new Map<string, number>(),
): number {
  const cached = cache.get(sessionId);
  if (cached !== undefined) return cached;
  const count = (childSessionsByParent.get(sessionId) ?? [])
    .reduce((sum, child) => sum + 1 + countSessionDescendants(child.id, childSessionsByParent, cache), 0);
  cache.set(sessionId, count);
  return count;
}

export function displayTitleForSession(
  session: ChatSession,
  childSessionsByParent: Map<string, ChatSession[]>,
): string {
  void childSessionsByParent;
  return session.title || `Session ${session.id.slice(0, 6)}`;
}

export function hasExpandedAncestor(
  session: ChatSession,
  sessionById: Map<string, ChatSession>,
  expandedRoots: Set<string>,
): boolean {
  let parentId = session.parentSessionId;
  const visited = new Set<string>();
  while (parentId) {
    if (visited.has(parentId)) return false;
    visited.add(parentId);
    if (expandedRoots.has(parentId)) return true;
    parentId = sessionById.get(parentId)?.parentSessionId;
  }
  return false;
}
