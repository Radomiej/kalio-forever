import type { ChatSession } from '@kalio/types';

const ACTIVE_AGENT_WINDOW_MS = 24 * 60 * 60 * 1000;

export type SessionOriginFilter = 'all' | 'user' | 'agent' | 'archived';

export type SessionListEntry =
  | { type: 'session'; session: ChatSession; depth: number }
  | { type: 'root'; session: ChatSession; childCount: number };

export const SESSION_ORIGIN_FILTERS: ReadonlyArray<{ id: SessionOriginFilter; label: string; shortLabel?: string }> = [
  { id: 'all', label: 'All' },
  { id: 'user', label: 'User' },
  { id: 'agent', label: 'Agents' },
  { id: 'archived', label: 'Archived', shortLabel: 'Old' },
];

export function sortSessionsForSidebar(sessions: ChatSession[]): ChatSession[] {
  const sessionById = new Map(sessions.map((session) => [session.id, session]));

  const getRootSessionId = (session: ChatSession): string => {
    let current = session;
    const visited = new Set<string>();

    while (current.parentSessionId) {
      if (visited.has(current.id)) break;
      visited.add(current.id);
      const parent = sessionById.get(current.parentSessionId);
      if (!parent) break;
      current = parent;
    }

    return current.id;
  };

  const groups = new Map<string, ChatSession[]>();
  sessions.forEach((session) => {
    const rootId = getRootSessionId(session);
    groups.set(rootId, [...(groups.get(rootId) ?? []), session]);
  });

  return [...groups.entries()]
    .map(([rootId, members]) => ({
      rootId,
      members,
      sortUpdatedAt: Math.max(...members.map((member) => member.updatedAt)),
    }))
    .sort((left, right) => right.sortUpdatedAt - left.sortUpdatedAt)
    .flatMap(({ rootId, members }) => members.slice().sort((left, right) => {
      const leftIsRoot = left.id === rootId;
      const rightIsRoot = right.id === rootId;

      if (leftIsRoot !== rightIsRoot) return leftIsRoot ? -1 : 1;

      const depthDiff = getSessionDepth(left, sessionById) - getSessionDepth(right, sessionById);
      if (depthDiff !== 0) return depthDiff;

      const createdAtDiff = left.createdAt - right.createdAt;
      if (createdAtDiff !== 0) return createdAtDiff;

      return left.id.localeCompare(right.id);
    }));
}

function getSessionDepth(session: ChatSession, sessionById: Map<string, ChatSession>): number {
  let depth = 0;
  let current = session;
  const visited = new Set<string>();

  while (current.parentSessionId) {
    if (visited.has(current.id)) break;
    visited.add(current.id);
    const parent = sessionById.get(current.parentSessionId);
    if (!parent) break;
    depth += 1;
    current = parent;
  }

  return depth;
}

function getRootSession(session: ChatSession, sessionById: Map<string, ChatSession>): ChatSession {
  let current = session;
  const visited = new Set<string>();

  while (current.parentSessionId) {
    if (visited.has(current.id)) break;
    visited.add(current.id);
    const parent = sessionById.get(current.parentSessionId);
    if (!parent) break;
    current = parent;
  }

  return current;
}

function isAgentStartedSession(session: ChatSession): boolean {
  return Boolean(session.parentSessionId) || session.kind === 'subagent' || session.kind === 'cli-agent';
}

function matchesOriginFilter(session: ChatSession, filter: SessionOriginFilter): boolean {
  if (filter === 'user') return !isAgentStartedSession(session);
  if (filter === 'agent' || filter === 'archived') return isAgentStartedSession(session);
  return true;
}

function hasLoadedParent(session: ChatSession, sessionById?: Map<string, ChatSession>): boolean {
  if (!session.parentSessionId) return false;
  return sessionById?.has(session.parentSessionId) ?? true;
}

export function isVisibleSidebarSession(
  session: ChatSession,
  activeSessionId: string | null,
  filter: SessionOriginFilter,
  sessionById?: Map<string, ChatSession>,
): boolean {
  if (!matchesOriginFilter(session, filter)) return false;
  if (filter === 'archived') return isAgentStartedSession(session);
  if (filter === 'agent') return session.id === activeSessionId || Date.now() - session.updatedAt <= ACTIVE_AGENT_WINDOW_MS;
  return !hasLoadedParent(session, sessionById) || session.id === activeSessionId;
}

export function buildSessionListEntries(
  orderedSessions: ChatSession[],
  activeSessionId: string | null,
  filter: SessionOriginFilter,
): SessionListEntry[] {
  const sessionById = new Map(orderedSessions.map((session) => [session.id, session]));
  const visibleSessions = orderedSessions.filter((session) => isVisibleSidebarSession(session, activeSessionId, filter, sessionById));

  if (filter !== 'agent') {
    return visibleSessions.map((session) => ({
      type: 'session',
      session,
      depth: getSessionDepth(session, sessionById),
    }));
  }

  const entries: SessionListEntry[] = [];
  let lastRootId: string | null = null;

  visibleSessions.forEach((session) => {
    const root = getRootSession(session, sessionById);
    if (root.id !== lastRootId) {
      const childCount = visibleSessions.filter((candidate) => getRootSession(candidate, sessionById).id === root.id).length;
      entries.push({ type: 'root', session: root, childCount });
      lastRootId = root.id;
    }

    entries.push({
      type: 'session',
      session,
      depth: Math.max(1, getSessionDepth(session, sessionById)),
    });
  });

  return entries;
}
