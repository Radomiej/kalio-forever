export const ARCHITECTURE_RUNTIME_STOP = Symbol('ARCHITECTURE_RUNTIME_STOP');

export type ArchitectureRuntimeStopPort = {
  stopRunsForSessions(sessionIds: readonly string[]): Promise<readonly string[]>;
  findActiveSessionIdForSessions?(sessionIds: readonly string[]): string | undefined;
};
