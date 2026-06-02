import { Injectable, Logger } from '@nestjs/common';

type QueueEntry<T> = {
  run: () => Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
};

type ProviderQueue = {
  active: number;
  pending: Array<QueueEntry<unknown>>;
};

@Injectable()
export class ProviderStreamLimiterService {
  private readonly logger = new Logger(ProviderStreamLimiterService.name);
  private readonly queues = new Map<string, ProviderQueue>();

  async run<T>(key: string, maxConcurrent: number, task: () => Promise<T>): Promise<T> {
    const normalizedMax = Math.max(1, Math.floor(maxConcurrent));
    const queue = this.queueFor(key);

    if (queue.active < normalizedMax) {
      queue.active += 1;
      return this.runNow(key, queue, task);
    }

    this.logger.debug(`Queueing LLM stream for ${key}; active=${queue.active}, pending=${queue.pending.length + 1}`);
    return new Promise<T>((resolve, reject) => {
      queue.pending.push({ run: task as () => Promise<unknown>, resolve: resolve as (value: unknown) => void, reject });
    });
  }

  snapshot(): Record<string, { active: number; pending: number }> {
    return Object.fromEntries([...this.queues.entries()].map(([key, queue]) => [
      key,
      { active: queue.active, pending: queue.pending.length },
    ]));
  }

  private queueFor(key: string): ProviderQueue {
    const existing = this.queues.get(key);
    if (existing) {
      return existing;
    }
    const created: ProviderQueue = { active: 0, pending: [] };
    this.queues.set(key, created);
    return created;
  }

  private async runNow<T>(key: string, queue: ProviderQueue, task: () => Promise<T>): Promise<T> {
    try {
      return await task();
    } finally {
      this.release(key, queue);
    }
  }

  private release(key: string, queue: ProviderQueue): void {
    queue.active = Math.max(0, queue.active - 1);
    const next = queue.pending.shift();
    if (!next) {
      if (queue.active === 0) {
        this.queues.delete(key);
      }
      return;
    }

    queue.active += 1;
    void this.runNow(key, queue, next.run).then(next.resolve, next.reject);
  }
}
