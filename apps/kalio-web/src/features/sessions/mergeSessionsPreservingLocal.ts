import type { ChatSession } from '@kalio/types';
import { isPendingHostSession } from '../chat/pendingHostSession';

const sessionFields = {
  id: true, personaId: true, title: true, kind: true, parentSessionId: true,
  parentTurnId: true, parentToolCallId: true, projectId: true, executionProfileId: true,
  externalThreadId: true, runtimeContext: true, createdAt: true, updatedAt: true,
} satisfies Record<keyof ChatSession, true>;

// Runtime context is persisted JSON, including dynamic architectureContext fields.
// Compare every nested value; timestamps or selected profile fields alone are insufficient.
function equalContextValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length
      && left.every((value: unknown, index) => equalContextValue(value, right[index]));
  }
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const keys = Object.keys(leftRecord);
  return keys.length === Object.keys(rightRecord).length
    && keys.every((key) => Object.hasOwn(rightRecord, key) && equalContextValue(leftRecord[key], rightRecord[key]));
}

function equalSession(left: ChatSession, right: ChatSession): boolean {
  // Unknown future fields must not be silently dropped by this contract-bounded comparison.
  return Object.keys(right).every((key) => Object.hasOwn(sessionFields, key))
    && (Object.keys(sessionFields) as Array<keyof ChatSession>)
      .every((key) => equalContextValue(left[key], right[key]));
}

export function mergeSessionsPreservingLocal(current: ChatSession[], incoming: ChatSession[]): ChatSession[] {
  const currentById = new Map(current.map((session) => [session.id, session] as const));
  const incomingIds = new Set(incoming.map((session) => session.id));
  const pendingLocalSessions = current.filter((session) => (
    isPendingHostSession(session) && !incomingIds.has(session.id)
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
      const merged = { ...existing, ...session };
      return equalSession(existing, merged) ? existing : merged;
    }),
  ];
}
