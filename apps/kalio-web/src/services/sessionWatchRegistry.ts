import { eventBus } from './eventBus';
import { isPendingHostSessionId } from '../features/chat/pendingHostSession';

const baselineSessionIds = new Set<string>();
const stickySessionIds = new Set<string>();
const identifiedSessionIds = new Set<string>();

export function replaceBaselineWatchedSessions(sessionIds: Iterable<string>, reason: string): void {
  baselineSessionIds.clear();
  for (const sessionId of sessionIds) {
    const normalized = normalizeSessionId(sessionId);
    if (!normalized) {
      continue;
    }
    baselineSessionIds.add(normalized);
    identifySessionOnce(normalized, reason);
  }
}

export function identifyWatchedSession(
  sessionId: string | null | undefined,
  reason: string,
  options: { sticky?: boolean } = {},
): void {
  const normalized = normalizeSessionId(sessionId);
  if (!normalized || isPendingHostSessionId(normalized)) {
    return;
  }

  if (options.sticky) {
    stickySessionIds.add(normalized);
  }
  identifySessionOnce(normalized, reason);
}

export function resetSessionWatchConnectionEpoch(reason: string): void {
  identifiedSessionIds.clear();
  debugWatch('reset', '*', reason);
  for (const sessionId of baselineSessionIds) {
    identifySessionOnce(sessionId, `${reason}:baseline`);
  }
  for (const sessionId of stickySessionIds) {
    identifySessionOnce(sessionId, `${reason}:sticky`);
  }
}

export function clearSessionWatchRegistry(): void {
  baselineSessionIds.clear();
  stickySessionIds.clear();
  identifiedSessionIds.clear();
}

function identifySessionOnce(sessionId: string, reason: string): void {
  if (identifiedSessionIds.has(sessionId)) {
    debugWatch('skip', sessionId, reason);
    return;
  }

  eventBus.identifySession(sessionId);
  identifiedSessionIds.add(sessionId);
  debugWatch('identify', sessionId, reason);
}

function normalizeSessionId(sessionId: string | null | undefined): string | null {
  if (typeof sessionId !== 'string') {
    return null;
  }
  const normalized = sessionId.trim();
  return normalized.length > 0 ? normalized : null;
}

function debugWatch(action: 'identify' | 'skip' | 'reset', sessionId: string, reason: string): void {
  if (!import.meta.env.DEV) {
    return;
  }
  console.debug(`[session-watch] ${action}`, { sessionId, reason });
}
