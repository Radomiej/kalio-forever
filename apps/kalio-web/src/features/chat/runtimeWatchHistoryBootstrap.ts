import type { ChatSession } from '@kalio/types';
import type { RuntimeWatchTarget } from '../../services/sessionBootstrap';
import { useAgentStore } from '../../store/agentStore';
import { useSessionStore } from '../../store/sessionStore';
import { buildChildSessionsByParent } from '../sessions/sessionTreeDisplay';
import { hydrateSessionHistoryIntoStore } from './historyHydration';
import { DEFAULT_CHILD_SESSION_HISTORY_LIMIT, fetchSessionHistoryWindow } from './sessionHistoryApi';

const RECENT_RUNTIME_HISTORY_WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_RECENT_RUNTIME_HISTORY_SESSIONS = 24;
const RUNTIME_WATCH_HISTORY_PRELOAD_CONCURRENCY = 4;

async function skipBackgroundArchitectureProjectionFetch(): Promise<never> {
  throw new Error('Background history preload skips architecture projection fetch');
}

function collectDescendantSessionIds(
  rootSessionId: string,
  childSessionsByParent: Map<string, ChatSession[]>,
): string[] {
  const collected: string[] = [];
  const queue = [...(childSessionsByParent.get(rootSessionId) ?? [])];

  while (queue.length > 0) {
    const session = queue.shift();
    if (!session) {
      continue;
    }
    collected.push(session.id);
    queue.push(...(childSessionsByParent.get(session.id) ?? []));
  }

  return collected;
}

function isRecentRuntimeConversationSession(session: ChatSession, now: number): boolean {
  if (now - session.updatedAt > RECENT_RUNTIME_HISTORY_WINDOW_MS) {
    return false;
  }

  if (session.parentSessionId) {
    return true;
  }

  if (session.kind === 'subagent' || session.kind === 'cli-agent' || session.kind === 'agent-flow') {
    return true;
  }

  return session.runtimeContext?.runtimeKind === 'agent-flow-branch'
    || session.runtimeContext?.runtimeKind === 'agent-flow-root'
    || session.runtimeContext?.runtimeKind === 'cli-agent';
}

export function collectRuntimeWatchSessionIds(
  sessions: ChatSession[],
  runtimeWatchTargets: RuntimeWatchTarget[],
): string[] {
  const childSessionsByParent = buildChildSessionsByParent(sessions);
  const ids = new Set<string>();
  const now = Date.now();

  runtimeWatchTargets.forEach((target) => {
    if (!target.sessionId.trim()) {
      return;
    }
    ids.add(target.sessionId);
    collectDescendantSessionIds(target.sessionId, childSessionsByParent).forEach((sessionId) => {
      ids.add(sessionId);
    });
  });

  sessions
    .filter((session) => isRecentRuntimeConversationSession(session, now))
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, MAX_RECENT_RUNTIME_HISTORY_SESSIONS)
    .forEach((session) => {
      ids.add(session.id);
    });

  return [...ids];
}

export async function preloadRuntimeWatchSessionHistory(params: {
  sessions: ChatSession[];
  runtimeWatchTargets: RuntimeWatchTarget[];
  force?: boolean;
}): Promise<void> {
  const sessionIds = collectRuntimeWatchSessionIds(params.sessions, params.runtimeWatchTargets);
  if (sessionIds.length === 0) {
    return;
  }

  for (let index = 0; index < sessionIds.length; index += RUNTIME_WATCH_HISTORY_PRELOAD_CONCURRENCY) {
    const batch = sessionIds.slice(index, index + RUNTIME_WATCH_HISTORY_PRELOAD_CONCURRENCY);
    await Promise.all(batch.map(async (sessionId) => {
      const sessionStore = useSessionStore.getState();
      if (!params.force && sessionStore.isSessionHydrated(sessionId)) {
        return;
      }

      try {
        await hydrateSessionHistoryIntoStore({
        sessionId,
        getSessions: () => [],
        getSessionMessages: (targetSessionId) => useSessionStore.getState().getSessionMessages(targetSessionId),
        setMessages: useSessionStore.getState().setMessages,
        setSessionHistoryMeta: useSessionStore.getState().setSessionHistoryMeta,
          setAgentTurns: useSessionStore.getState().setAgentTurns,
          getSessionAgentTurns: (targetSessionId) => useSessionStore.getState().getSessionAgentTurns(targetSessionId),
          getSessionActiveTurnId: (targetSessionId) => useSessionStore.getState().getSessionActiveTurnId(targetSessionId),
          hasActiveLoopForSession: (targetSessionId) => useAgentStore.getState().hasActiveLoopForSession(targetSessionId),
        fetchMessages: (targetSessionId) => fetchSessionHistoryWindow(targetSessionId, {
          limit: DEFAULT_CHILD_SESSION_HISTORY_LIMIT,
        }),
        fetchArchitectureRunProjection: skipBackgroundArchitectureProjectionFetch,
      });
      } catch (err: unknown) {
        console.warn('[runtimeWatchHistoryBootstrap] failed to preload watch session history', {
          sessionId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }));
  }
}
