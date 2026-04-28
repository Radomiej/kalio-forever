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
    const start = Date.now();

    await Promise.all([
      mutex.runExclusive('A', async () => tick(30)),
      mutex.runExclusive('B', async () => tick(30)),
      mutex.runExclusive('C', async () => tick(30)),
    ]);

    const elapsed = Date.now() - start;
    // Three serial 30ms tasks would take >=90ms; parallel <=60ms with slack.
    expect(elapsed).toBeLessThan(80);
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
});
