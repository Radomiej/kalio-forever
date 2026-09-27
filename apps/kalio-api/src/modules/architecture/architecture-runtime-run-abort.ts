export class ArchitectureRuntimeRunAbort {
  private readonly controllers = new Map<string, AbortController>();

  async execute<T>(runId: string, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController();
    this.controllers.set(runId, controller);
    try {
      return await operation(controller.signal);
    } finally {
      if (this.controllers.get(runId) === controller) this.controllers.delete(runId);
    }
  }

  abort(runId: string, reason: Error): void {
    this.controllers.get(runId)?.abort(reason);
  }

  async waitForStoppedExecution(stopped: boolean, execution: Promise<unknown> | undefined): Promise<void> {
    if (stopped && execution) await execution.catch(() => undefined);
  }
}
