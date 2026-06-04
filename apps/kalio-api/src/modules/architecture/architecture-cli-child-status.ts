import type { ArchitectureChildAgentProjection } from '@kalio/types';

export function isCompletedCliChildStatus(status: string | undefined): boolean {
  return status === 'completed'
    || status === 'terminal-success'
    || status === 'success'
    || status === 'exited';
}

export function mergeChildAgentStatus(
  current: ArchitectureChildAgentProjection['status'] | undefined,
  incoming: ArchitectureChildAgentProjection['status'],
): ArchitectureChildAgentProjection['status'] {
  if (incoming === 'unknown' && current) {
    return current;
  }
  if (current && isTerminalChildAgentStatus(current) && !isTerminalChildAgentStatus(incoming)) {
    return current;
  }
  return incoming;
}

function isTerminalChildAgentStatus(status: ArchitectureChildAgentProjection['status'] | undefined): boolean {
  return isCompletedCliChildStatus(status) || status === 'failed' || status === 'stopped';
}
