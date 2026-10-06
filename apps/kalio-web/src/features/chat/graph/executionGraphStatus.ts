import type { ExecutionGraphNodeStatus } from './executionGraphModel.helpers';

export function aggregateGraphStatus(statuses: ExecutionGraphNodeStatus[]): ExecutionGraphNodeStatus {
  for (const status of ['error', 'waiting', 'running', 'cancelled', 'success'] as const) {
    if (statuses.includes(status)) return status;
  }
  return 'idle';
}
