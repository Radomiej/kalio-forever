import { describe, it, expect } from 'vitest';
import { PerKeyMutex } from '../per-key-mutex';

const tick = (ms = 0) => new Promise<void>((r) => setTimeout(r, ms));

describe('PerKeyMutex', () => {
  it('serialises concurrent calls for the same key', async () => {
    const mutex = new PerKeyMutex();
    const trace: number[] = [];
    let inFlight = 0;
    let maxInFlight = 0;

    const task = (i: number) =>
      mutex.runExclusive('A', async () => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await tick(5);
        trace.push(i);
        inFlight--;
      });

    await Promise.all(Array.from({ length: 20 }, (_, i) => task(i)));

    expect(maxInFlight).toBe(1);
    expect(trace).toEqual(Array.from({ length: 20 }, (_, i) => i));
  });

  it('runs different keys independently (in parallel)', async () => {
    const mutex = new PerKeyMutex();
    let releaseTasks!: () => void;
    const release = new Promise<void>((resolve) => {
      releaseTasks = resolve;
    });
    let started = 0;
    let inFlight = 0;
    let maxInFlight = 0;

    const task = (key: string) =>
      mutex.runExclusive(key, async () => {
        started++;
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await release;
        inFlight--;
      });

    const tasks = Promise.all([
      task('A'),
      task('B'),
      task('C'),
    ]);

    await expect.poll(() => started).toBe(3);
    expect(maxInFlight).toBe(3);
    releaseTasks();
    await tasks;
  });

  it('releases the key after settle (no memory leak)', async () => {
    const mutex = new PerKeyMutex();
    await mutex.runExclusive('A', async () => tick(1));
    await mutex.runExclusive('B', async () => tick(1));
    // Allow microtask cleanup to run
    await tick(5);
    expect(mutex.size()).toBe(0);
  });

  it('does not let a rejected fn block subsequent callers', async () => {
    const mutex = new PerKeyMutex();
    await expect(
      mutex.runExclusive('A', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    const result = await mutex.runExclusive('A', async () => 42);
    expect(result).toBe(42);
  });

  it('returns the fn result', async () => {
    const mutex = new PerKeyMutex();
    const result = await mutex.runExclusive('A', async () => 'hello');
    expect(result).toBe('hello');
  });

  it('size() returns 0 after a rejected fn settles (no memory leak on rejection)', async () => {
    const mutex = new PerKeyMutex();
    await expect(
      mutex.runExclusive('A', async () => { throw new Error('boom'); }),
    ).rejects.toThrow('boom');
    await tick(5);
    expect(mutex.size()).toBe(0);
  });

  it('concurrent rejections for the same key do not cascade errors to later callers', async () => {
    const mutex = new PerKeyMutex();
    const results: string[] = [];

    const p1 = mutex.runExclusive('A', async () => {
      await tick(5);
      throw new Error('first failure');
    }).catch(() => results.push('caught-1'));

    const p2 = mutex.runExclusive('A', async () => {
      await tick(5);
      throw new Error('second failure');
    }).catch(() => results.push('caught-2'));

    const p3 = mutex.runExclusive('A', async () => {
      await tick(1);
      results.push('ok');
      return 'ok';
    });

    await Promise.all([p1, p2, p3]);
    // Each caller handles its own error independently; p3 must succeed
    expect(results).toContain('caught-1');
    expect(results).toContain('caught-2');
    expect(results).toContain('ok');
  });
});
