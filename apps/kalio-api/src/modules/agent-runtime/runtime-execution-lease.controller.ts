import type { RuntimeExecutionLease, RuntimeExecutionPriority, RuntimeExecutionRequest, RuntimeExecutionScheduler } from './runtime-execution.scheduler';

export interface RuntimeExecutionLeaseController {
  acquire(): Promise<void>;
  release(): void;
  readonly lease: RuntimeExecutionLease | undefined;
}

export function createRuntimeExecutionLeaseController(
  scheduler: RuntimeExecutionScheduler | undefined,
  request: RuntimeExecutionRequest,
): RuntimeExecutionLeaseController {
  let activeLease: RuntimeExecutionLease | undefined;
  return {
    get lease() {
      return activeLease;
    },
    async acquire(): Promise<void> {
      if (!scheduler || activeLease) return;
      activeLease = await scheduler.acquire(request);
    },
    release(): void {
      activeLease?.release();
      activeLease = undefined;
    },
  };
}

export function runtimeExecutionPriority(runtimeKind: string | undefined): RuntimeExecutionPriority {
  return runtimeKind === 'chat' || runtimeKind === undefined ? 'foreground' : 'child';
}
