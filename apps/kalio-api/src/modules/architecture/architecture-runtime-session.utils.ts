import type { ArchitectureRun } from '@kalio/types';
import {
  getArchitectureHistorySessionId,
  getArchitectureHostSessionId,
  getArchitectureParentSessionId,
} from './architecture-session-context';

export function architectureRunBelongsToSessionSet(
  run: ArchitectureRun,
  sessionIds: ReadonlySet<string>,
): boolean {
  return sessionIdsForRun(run).some((sessionId) => sessionIds.has(sessionId));
}

export function findActiveArchitectureRunSessionId(
  runs: Iterable<ArchitectureRun>,
  sessionIds: readonly string[],
): string | undefined {
  const sessionIdSet = new Set(sessionIds.filter((sessionId) => sessionId.trim().length > 0));
  for (const run of runs) {
    if (run.status !== 'running' && run.status !== 'queued') continue;
    const activeSessionId = sessionIdsForRun(run).find((sessionId) => sessionIdSet.has(sessionId));
    if (activeSessionId) return activeSessionId;
  }
  return undefined;
}

function sessionIdsForRun(run: ArchitectureRun): string[] {
  return [
    run.rootSessionId,
    ...Object.values(run.branchSessionIds ?? {}),
    getArchitectureParentSessionId(run.context),
    getArchitectureHostSessionId(run.context),
    getArchitectureHistorySessionId(run.context),
  ].filter((sessionId): sessionId is string => typeof sessionId === 'string' && sessionId.length > 0);
}
