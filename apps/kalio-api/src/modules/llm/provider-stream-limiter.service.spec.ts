import { describe, expect, it } from 'vitest';
import { ProviderStreamLimiterService } from './provider-stream-limiter.service';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

describe('ProviderStreamLimiterService', () => {
  it('queues streams beyond the per-provider concurrency limit', async () => {
    const limiter = new ProviderStreamLimiterService();
    const first = deferred<string>();
    const second = deferred<string>();
    const started: string[] = [];

    const firstRun = limiter.run('xiaomimimo:default', 1, async () => {
      started.push('first');
      return first.promise;
    });
    const secondRun = limiter.run('xiaomimimo:default', 1, async () => {
      started.push('second');
      return second.promise;
    });

    await Promise.resolve();

    expect(started).toEqual(['first']);
    expect(limiter.snapshot()).toEqual({
      'xiaomimimo:default': { active: 1, pending: 1 },
    });

    first.resolve('one');
    await expect(firstRun).resolves.toBe('one');
    await Promise.resolve();

    expect(started).toEqual(['first', 'second']);
    second.resolve('two');
    await expect(secondRun).resolves.toBe('two');
    expect(limiter.snapshot()).toEqual({});
  });

  it('keeps provider queues independent', async () => {
    const limiter = new ProviderStreamLimiterService();
    const first = deferred<string>();
    const second = deferred<string>();
    const started: string[] = [];

    const firstRun = limiter.run('xiaomimimo:default', 1, async () => {
      started.push('xiaomi');
      return first.promise;
    });
    const secondRun = limiter.run('cometapi:https://api.cometapi.com/v1', 1, async () => {
      started.push('cometapi');
      return second.promise;
    });

    await Promise.resolve();

    expect(started).toEqual(['xiaomi', 'cometapi']);
    first.resolve('xiaomi done');
    second.resolve('comet done');
    await expect(firstRun).resolves.toBe('xiaomi done');
    await expect(secondRun).resolves.toBe('comet done');
  });
});
