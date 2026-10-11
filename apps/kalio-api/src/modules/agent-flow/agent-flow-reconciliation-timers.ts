/** Owns only reconciliation scheduling, never durable run state or Stop. */
export class AgentFlowReconciliationTimers {
  private readonly handles = new Set<ReturnType<typeof setTimeout>>();
  private disposed = false;

  get active(): boolean { return !this.disposed; }

  schedule(callback: () => void, delayMs: number): void {
    if (this.disposed) return;
    const handle = setTimeout(() => {
      this.handles.delete(handle);
      if (!this.disposed) callback();
    }, delayMs);
    this.handles.add(handle);
  }

  destroy(): void {
    this.disposed = true;
    for (const handle of this.handles) clearTimeout(handle);
    this.handles.clear();
  }
}
