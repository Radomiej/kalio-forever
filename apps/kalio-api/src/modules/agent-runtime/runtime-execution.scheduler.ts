import { Injectable, Optional } from '@nestjs/common';

export type RuntimeExecutionPriority = 'control' | 'foreground' | 'child';

export interface RuntimeExecutionRequest {
  projectId: string;
  priority: RuntimeExecutionPriority;
  label: string;
}

export interface RuntimeExecutionLease extends RuntimeExecutionRequest {
  /** Release the global execution permit. Safe to call more than once. */
  release(): void;
  /** Register a callback that runs once when the permit is released. */
  onRelease(listener: () => void): void;
}

interface PendingRequest {
  request: RuntimeExecutionRequest;
  resolve: (lease: RuntimeExecutionLease) => void;
}

const PRIORITY_ORDER: RuntimeExecutionPriority[] = ['control', 'foreground', 'child'];

@Injectable()
export class RuntimeExecutionScheduler {
  private readonly maxConcurrentExecutions: number;
  private readonly queues = new Map<RuntimeExecutionPriority, Map<string, PendingRequest[]>>();
  private readonly projectOrder = new Map<RuntimeExecutionPriority, string[]>();
  private readonly cursors = new Map<RuntimeExecutionPriority, number>();
  private running = 0;
  private queued = 0;

  constructor(@Optional() options: { maxConcurrentExecutions?: number } = {}) {
    const maxConcurrentExecutions = options.maxConcurrentExecutions ?? 5;
    if (!Number.isInteger(maxConcurrentExecutions) || maxConcurrentExecutions < 1) {
      throw new Error('maxConcurrentExecutions must be a positive integer.');
    }
    this.maxConcurrentExecutions = maxConcurrentExecutions;
    PRIORITY_ORDER.forEach((priority) => {
      this.queues.set(priority, new Map());
      this.projectOrder.set(priority, []);
      this.cursors.set(priority, 0);
    });
  }

  get activeCount(): number {
    return this.running;
  }

  get queuedCount(): number {
    return this.queued;
  }

  async acquire(request: RuntimeExecutionRequest): Promise<RuntimeExecutionLease> {
    const queueByProject = this.queues.get(request.priority);
    const projectOrder = this.projectOrder.get(request.priority);
    if (!queueByProject || !projectOrder) {
      throw new Error(`Unsupported runtime execution priority: ${request.priority}`);
    }

    return new Promise<RuntimeExecutionLease>((resolve) => {
      const projectQueue = queueByProject.get(request.projectId) ?? [];
      projectQueue.push({ request, resolve });
      queueByProject.set(request.projectId, projectQueue);
      if (!projectOrder.includes(request.projectId)) {
        const newProjectIndex = projectOrder.length;
        projectOrder.push(request.projectId);
        if (projectOrder.length > 1 && this.running > 0) {
          this.cursors.set(request.priority, newProjectIndex);
        }
      }
      this.queued += 1;
      this.pump();
    });
  }

  async run<T>(
    request: RuntimeExecutionRequest,
    operation: (lease: RuntimeExecutionLease) => Promise<T>,
  ): Promise<T> {
    const lease = await this.acquire(request);
    try {
      return await operation(lease);
    } finally {
      lease.release();
    }
  }

  private pump(): void {
    while (this.running < this.maxConcurrentExecutions) {
      const next = this.takeNext();
      if (!next) return;

      this.running += 1;
      this.queued -= 1;
      let released = false;
      const releaseListeners = new Set<() => void>();
      const lease: RuntimeExecutionLease = {
        ...next.request,
        release: () => {
          if (released) return;
          released = true;
          this.running -= 1;
          releaseListeners.forEach((listener) => listener());
          this.pump();
        },
        onRelease: (listener) => {
          if (released) {
            listener();
            return;
          }
          releaseListeners.add(listener);
        },
      };
      next.resolve(lease);
    }
  }

  private takeNext(): PendingRequest | null {
    for (const priority of PRIORITY_ORDER) {
      const queueByProject = this.queues.get(priority);
      const projectOrder = this.projectOrder.get(priority);
      if (!queueByProject || !projectOrder || projectOrder.length === 0) continue;

      const cursor = this.cursors.get(priority) ?? 0;
      for (let offset = 0; offset < projectOrder.length; offset += 1) {
        const index = (cursor + offset) % projectOrder.length;
        const projectId = projectOrder[index];
        const projectQueue = queueByProject.get(projectId);
        if (!projectQueue || projectQueue.length === 0) continue;

        const next = projectQueue.shift() ?? null;
        if (projectQueue.length === 0) {
          queueByProject.delete(projectId);
        }
        this.cursors.set(priority, (index + 1) % projectOrder.length);
        return next;
      }
    }
    return null;
  }
}
