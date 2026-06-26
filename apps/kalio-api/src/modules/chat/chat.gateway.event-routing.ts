import type { SocketEvents } from '@kalio/types';

const ACTIONABLE_SESSION_EVENTS = new Set<keyof SocketEvents>([
  'tool:confirmation_required',
  'agent:budget_required',
]);

export function getSocketEventSessionId(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const candidate = payload as { sessionId?: unknown };
  return typeof candidate.sessionId === 'string' ? candidate.sessionId : undefined;
}

export function isActionableSessionEvent(event: keyof SocketEvents): boolean {
  return ACTIONABLE_SESSION_EVENTS.has(event);
}
