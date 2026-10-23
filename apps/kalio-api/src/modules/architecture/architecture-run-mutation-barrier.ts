import { AsyncLocalStorage } from 'node:async_hooks';
import { types } from 'node:util';

interface RunQueue {
  tail: Promise<void>;
  queued: number;
  pending: number;
  terminal: boolean;
  activeToken?: symbol;
}

/** In-memory ordering only: callers own stop truth, currentness and durable ACKs. */
export class ArchitectureRunMutationBarrier {
  private readonly runs = new Map<string, RunQueue>();
  private readonly executing = new AsyncLocalStorage<{ queue: RunQueue; token: symbol }>();

  beginGoalMutation(runId: string): {
    commit<T>(operation: () => Promise<T> | T): Promise<T>;
    cancel(): void;
  } {
    const queue = this.queue(runId);
    this.assertNotReentrant(queue);
    if (queue.terminal) throw new Error('RUN_TERMINAL_PUBLISHED');
    queue.pending++;
    let state: 'pending' | 'committing' | 'used' = 'pending';
    return {
      commit: async <T>(operation: () => Promise<T> | T): Promise<T> => {
        if (state !== 'pending') throw new Error('GOAL_MUTATION_INTENT_USED');
        state = 'committing';
        try {
          return await this.enqueue(queue, () => {
            if (queue.terminal) throw new Error('RUN_TERMINAL_PUBLISHED');
            return operation();
          });
        } finally {
          state = 'used';
          queue.pending--;
        }
      },
      cancel: () => {
        if (state !== 'pending') return;
        state = 'used';
        queue.pending--;
      },
    };
  }

  async serializeStop<T>(runId: string, operation: () => Promise<T>): Promise<T> {
    return this.enqueue(this.queue(runId), operation);
  }

  async commitTerminal<T>(runId: string, input: {
    signal: AbortSignal;
    isStopRequested: () => boolean;
    validateCurrent: () => T & (T extends PromiseLike<unknown> ? never : unknown);
    publish: (validated: T) => void | { readonly then?: never };
  }): Promise<void> {
    const queue = this.queue(runId);
    await this.enqueue(queue, () => {
      const check = () => {
        if (queue.terminal) throw new Error('RUN_TERMINAL_PUBLISHED');
        const stopRequested = input.isStopRequested();
        if (input.signal.aborted || stopRequested) throw new Error('RUN_STOP_REQUESTED');
        if (queue.pending !== 0) throw new Error('GOAL_MUTATION_PENDING');
      };
      check();
      if (types.isAsyncFunction(input.validateCurrent) || types.isAsyncFunction(input.publish)) {
        throw new Error('RUN_BARRIER_ASYNC_CALLBACK');
      }
      const validated = input.validateCurrent();
      this.assertSynchronousResult(validated);
      check();
      this.assertSynchronousResult(input.publish(validated));
      queue.terminal = true;
    });
  }

  private assertSynchronousResult(value: unknown): void {
    if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return;
    let then: unknown;
    try { then = Reflect.get(value, 'then'); }
    catch { throw new Error('RUN_BARRIER_ASYNC_CALLBACK'); }
    if (typeof then !== 'function') return;
    // Drain rejection without awaiting; an invalid callback never authorizes terminal publication.
    void Promise.resolve(value).then(() => undefined, () => undefined);
    throw new Error('RUN_BARRIER_ASYNC_CALLBACK');
  }

  retire(runId: string): void {
    const queue = this.runs.get(runId);
    if (!queue) return;
    if (queue.queued !== 0 || queue.pending !== 0 || queue.activeToken) throw new Error('RUN_BARRIER_BUSY');
    this.runs.delete(runId);
  }

  private queue(runId: string): RunQueue {
    let queue = this.runs.get(runId);
    if (!queue) {
      queue = { tail: Promise.resolve(), queued: 0, pending: 0, terminal: false };
      this.runs.set(runId, queue);
    }
    return queue;
  }

  private assertNotReentrant(queue: RunQueue): void {
    const current = this.executing.getStore();
    if (current?.queue === queue && current.token === queue.activeToken) throw new Error('RUN_BARRIER_REENTRANT');
  }

  private enqueue<T>(queue: RunQueue, operation: () => Promise<T> | T): Promise<T> {
    this.assertNotReentrant(queue);
    queue.queued++;
    const result = queue.tail.then(() => {
      const token = Symbol();
      queue.activeToken = token;
      return this.executing.run({ queue, token }, async () => {
        try { return await operation(); }
        finally { queue.activeToken = undefined; queue.queued--; }
      });
    });
    // A rejected operation must not poison later queue entries.
    queue.tail = result.then(() => undefined, () => undefined);
    return result;
  }
}
