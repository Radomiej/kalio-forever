import type { ArchitectureRun } from '@kalio/types';
import { getArchitectureHistorySessionId, getArchitectureHostSessionId, getArchitectureParentSessionId } from './architecture-session-context';

export function architectureRunBelongsToSessionSet(run: ArchitectureRun, sessionIds: ReadonlySet<string>): boolean {
  return sessionIdsForRun(run).some((id) => sessionIds.has(id));
}

export function findActiveArchitectureRunSessionId(runs: Iterable<ArchitectureRun>, sessionIds: readonly string[]): string | undefined {
  const allowed = new Set(sessionIds.filter((id) => id.trim().length > 0));
  for (const run of runs) {
    if (run.status !== 'running' && run.status !== 'queued') continue;
    const selected = sessionIdsForRun(run).find((id) => allowed.has(id));
    if (selected) return selected;
  }
  return undefined;
}

function sessionIdsForRun(run: ArchitectureRun): string[] {
  return [run.rootSessionId, ...Object.values(run.branchSessionIds ?? {}),
    getArchitectureParentSessionId(run.context), getArchitectureHostSessionId(run.context),
    getArchitectureHistorySessionId(run.context),
  ].filter((id): id is string => typeof id === 'string' && id.length > 0);
}
