/**
 * Per-key mutex implemented with a Promise chain.
 *
 * Node.js is single-threaded; race conditions only happen between `await`
 * points. This serialises async functions sharing the same key so that no
 * two of them are mid-execution simultaneously, while different keys run
 * independently.
 *
 * Implementation: for each key we keep the tail of a Promise chain. New
 * callers chain onto the tail. The map entry is cleared once our chain
 * settles AND no one else has chained onto it (sentinel pattern).
 */
export class PerKeyMutex {
  private readonly tails = new Map<string, Promise<unknown>>();

  async runExclusive<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.tails.get(key) ?? Promise.resolve();

    // Chain: wait for prev (regardless of outcome), then run fn.
    // Use a swallowing chain as the stored tail so prior errors don't
    // cascade-reject every future caller.
    const run = prev.then(
      () => fn(),
      () => fn(),
    );
    const tail = run.then(
      () => undefined,
      () => undefined,
    );
    this.tails.set(key, tail);

    try {
      return await run;
    } finally {
      // Cleanup: only delete if we are still the tail (no one chained after).
      if (this.tails.get(key) === tail) {
        this.tails.delete(key);
      }
    }
  }

  /** Test helper: number of keys currently held. */
  size(): number {
    return this.tails.size;
  }
}
