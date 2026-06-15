import type { ChatRunSnapshot, SocketEvents } from '@kalio/types';

function sameNullableString(left: string | undefined, right: string | undefined): boolean {
  return (left ?? null) === (right ?? null);
}

function sameRunSnapshot(left: ChatRunSnapshot | undefined, right: ChatRunSnapshot | undefined): boolean {
  if (!left && !right) {
    return true;
  }
  if (!left || !right) {
    return false;
  }

  return left.id === right.id
    && left.sessionId === right.sessionId
    && left.turnId === right.turnId
    && left.phase === right.phase
    && left.status === right.status
    && sameNullableString(left.provider, right.provider)
    && sameNullableString(left.model, right.model)
    && left.retryCount === right.retryCount
    && left.safeResume === right.safeResume
    && sameNullableString(left.errorCode, right.errorCode)
    && sameNullableString(left.errorMessage, right.errorMessage)
    && (left.completedAt ?? null) === (right.completedAt ?? null);
}

export function areSessionStatusSnapshotsEquivalent(
  left: SocketEvents['session:status'] | undefined,
  right: SocketEvents['session:status'],
): boolean {
  if (!left) {
    return false;
  }

  return left.sessionId === right.sessionId
    && left.active === right.active
    && (left.turnId ?? null) === (right.turnId ?? null)
    && left.queueLength === right.queueLength
    && sameRunSnapshot(left.run, right.run);
}
