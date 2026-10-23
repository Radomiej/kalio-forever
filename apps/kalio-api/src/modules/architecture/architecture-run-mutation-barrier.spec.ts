import { describe, expect, it, vi } from 'vitest';
import { ArchitectureRunMutationBarrier } from './architecture-run-mutation-barrier';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((ack) => { resolve = ack; });
  return { promise, resolve };
}

function terminal(overrides: Partial<{
  signal: AbortSignal; isStopRequested: () => boolean;
  validateCurrent: () => string; publish: (value: string) => void;
}> = {}) {
  return {
    signal: new AbortController().signal, isStopRequested: () => false,
    validateCurrent: () => 'validated', publish: vi.fn<(value: string) => void>(), ...overrides,
  };
}

// Deliberately cross the type boundary to exercise invalid runtime callers.
function invalidTerminal(barrier: ArchitectureRunMutationBarrier, input: unknown): Promise<void> {
  return Reflect.apply(barrier.commitTerminal, barrier, ['run', input]) as Promise<void>;
}

describe('ArchitectureRunMutationBarrier', () => {
  it('constrains Promise callbacks at the TypeScript boundary', () => {
    const barrier = new ArchitectureRunMutationBarrier();
    const invalidPromiseCallbacks = () => {
      // @ts-expect-error Promise validation is not a synchronous binding.
      void barrier.commitTerminal<Promise<string>>('run', { ...terminal(), validateCurrent: async () => 'value', publish: () => undefined });
      // @ts-expect-error Unlike a plain void return, this signature rejects async publication.
      void barrier.commitTerminal('run', { ...terminal(), publish: async () => undefined });
      // @ts-expect-error A non-async function returning Promise is also rejected.
      void barrier.commitTerminal('run', { ...terminal(), publish: () => Promise.resolve() });
    };
    void invalidPromiseCallbacks;
  });

  it('sanitizes a throwing then getter and releases the queue', async () => {
    const barrier = new ArchitectureRunMutationBarrier();
    const value = Object.defineProperty({}, 'then', { get: () => { throw new Error('private getter secret'); } });
    const callbacks = terminal();
    await expect(invalidTerminal(barrier, { ...callbacks, validateCurrent: () => value }))
      .rejects.toThrow(/^RUN_BARRIER_ASYNC_CALLBACK$/);
    expect(callbacks.publish).not.toHaveBeenCalled();
    await barrier.commitTerminal('run', terminal());
  });

  it.each(['validate', 'publish'])('rejects declared async %s before invocation', async (kind) => {
    const barrier = new ArchitectureRunMutationBarrier();
    let invoked = 0;
    const asyncCallback = async () => { invoked++; throw new Error('private callback secret'); };
    const callbacks = terminal();
    const input = kind === 'validate' ? { ...callbacks, validateCurrent: asyncCallback }
      : { ...callbacks, publish: asyncCallback };
    await expect(invalidTerminal(barrier, input)).rejects.toThrow('RUN_BARRIER_ASYNC_CALLBACK');
    expect(invoked).toBe(0); expect(callbacks.publish).not.toHaveBeenCalled();
    await barrier.commitTerminal('run', terminal());
  });

  it.each(['validate', 'publish'])('rejects hidden pending Promise from %s without awaiting or terminal latch', async (kind) => {
    const barrier = new ArchitectureRunMutationBarrier();
    const gate = deferred();
    const callbacks = terminal();
    const input = kind === 'validate' ? { ...callbacks, validateCurrent: () => gate.promise }
      : { ...callbacks, publish: () => gate.promise };
    await expect(invalidTerminal(barrier, input)).rejects.toThrow('RUN_BARRIER_ASYNC_CALLBACK');
    expect(callbacks.publish).not.toHaveBeenCalled();
    expect(await barrier.beginGoalMutation('run').commit(() => 1)).toBe(1);
    gate.resolve();
    await barrier.commitTerminal('run', terminal());
  });

  it.each(['validate', 'publish'])('consumes rejected hidden Promise from %s without raw error leak', async (kind) => {
    const barrier = new ArchitectureRunMutationBarrier();
    const callback = () => Promise.reject(new Error('private callback secret'));
    const callbacks = terminal();
    const input = kind === 'validate' ? { ...callbacks, validateCurrent: callback }
      : { ...callbacks, publish: callback };
    await expect(invalidTerminal(barrier, input)).rejects.toThrow(/^RUN_BARRIER_ASYNC_CALLBACK$/);
    // Allow rejection jobs to drain; Vitest also fails on unhandled rejections.
    await new Promise<void>((resolve) => setImmediate(resolve));
    await barrier.commitTerminal('run', terminal());
  });

  it.each(['validate', 'publish'])('rejects custom thenable from %s and consumes its rejection', async (kind) => {
    const barrier = new ArchitectureRunMutationBarrier();
    let consumed = 0;
    const callback = () => ({ then: (_resolve: unknown, reject: (error: unknown) => void) => {
      consumed++; reject(new Error('private thenable secret'));
    } });
    const callbacks = terminal();
    const input = kind === 'validate' ? { ...callbacks, validateCurrent: callback }
      : { ...callbacks, publish: callback };
    await expect(invalidTerminal(barrier, input)).rejects.toThrow(/^RUN_BARRIER_ASYNC_CALLBACK$/);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(consumed).toBe(1);
    await barrier.commitTerminal('run', terminal());
  });

  it('publishes exactly once for concurrent terminal attempts', async () => {
    const barrier = new ArchitectureRunMutationBarrier();
    const callbacks = terminal();
    const results = await Promise.allSettled([
      barrier.commitTerminal('run', callbacks), barrier.commitTerminal('run', callbacks),
    ]);
    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'rejected']);
    expect(callbacks.publish).toHaveBeenCalledOnce();
  });

  it('uses synchronous external stop truth while durable stop waits in the queue', async () => {
    const barrier = new ArchitectureRunMutationBarrier();
    const gate = deferred(); const entered = deferred();
    const update = barrier.beginGoalMutation('run').commit(async () => { entered.resolve(); await gate.promise; });
    await entered.promise;
    let stopped = false;
    const callbacks = terminal({ isStopRequested: () => stopped });
    const completion = barrier.commitTerminal('run', callbacks);
    stopped = true;
    let durableStops = 0;
    const stop = barrier.serializeStop('run', async () => { durableStops++; });
    const rejected = expect(completion).rejects.toThrow('RUN_STOP_REQUESTED');
    gate.resolve(); await update; await rejected; await stop;
    expect(durableStops).toBe(1); expect(callbacks.publish).not.toHaveBeenCalled();
  });

  it('requires all independent pending intents to settle before terminal publication', async () => {
    const barrier = new ArchitectureRunMutationBarrier();
    const first = barrier.beginGoalMutation('run');
    const second = barrier.beginGoalMutation('run');
    await first.commit(() => undefined);
    await expect(barrier.commitTerminal('run', terminal())).rejects.toThrow('GOAL_MUTATION_PENDING');
    second.cancel();
    await barrier.commitTerminal('run', terminal());
  });

  it('checks signal after the external stop predicate itself returns', async () => {
    const barrier = new ArchitectureRunMutationBarrier();
    const abort = new AbortController(); let checks = 0;
    const callbacks = terminal({ signal: abort.signal,
      isStopRequested: () => { if (++checks === 2) abort.abort(); return false; } });
    await expect(barrier.commitTerminal('run', callbacks)).rejects.toThrow('RUN_STOP_REQUESTED');
    expect(callbacks.publish).not.toHaveBeenCalled();
  });

  it('marks intent synchronously so a pending preparation beats an already queued terminal', async () => {
    const barrier = new ArchitectureRunMutationBarrier();
    const callbacks = terminal();
    const completion = barrier.commitTerminal('run', callbacks);
    const intent = barrier.beginGoalMutation('run');
    await expect(completion).rejects.toThrow('GOAL_MUTATION_PENDING');
    expect(callbacks.publish).not.toHaveBeenCalled();
    expect(await intent.commit(() => 'updated')).toBe('updated');
    await barrier.commitTerminal('run', callbacks);
    expect(callbacks.publish).toHaveBeenCalledExactlyOnceWith('validated');
  });

  it('serializes mutation commits and stop, preserving results', async () => {
    const barrier = new ArchitectureRunMutationBarrier();
    const gate = deferred();
    const order: string[] = [];
    const intent = barrier.beginGoalMutation('run');
    const update = intent.commit(async () => { order.push('update'); await gate.promise; return 17; });
    const stop = barrier.serializeStop('run', async () => { order.push('stop'); return 23; });
    await Promise.resolve();
    expect(order).toEqual(['update']);
    gate.resolve();
    expect(await update).toBe(17);
    expect(await stop).toBe(23);
    expect(order).toEqual(['update', 'stop']);
  });

  it.each(['signal', 'stop'])('checks %s before validation', async (kind) => {
    const barrier = new ArchitectureRunMutationBarrier();
    const abort = new AbortController(); abort.abort();
    const validateCurrent = vi.fn(() => 'validated');
    const callbacks = terminal({ signal: kind === 'signal' ? abort.signal : new AbortController().signal,
      isStopRequested: () => kind === 'stop', validateCurrent });
    await expect(barrier.commitTerminal('run', callbacks)).rejects.toThrow('RUN_STOP_REQUESTED');
    expect(validateCurrent).not.toHaveBeenCalled(); expect(callbacks.publish).not.toHaveBeenCalled();
  });

  it.each(['signal', 'stop'])('rechecks %s after validation with no publication', async (kind) => {
    const barrier = new ArchitectureRunMutationBarrier();
    const abort = new AbortController(); let stopped = false;
    const callbacks = terminal({ signal: abort.signal, isStopRequested: () => stopped,
      validateCurrent: () => { if (kind === 'signal') abort.abort(); else stopped = true; return 'validated'; } });
    await expect(barrier.commitTerminal('run', callbacks)).rejects.toThrow('RUN_STOP_REQUESTED');
    expect(callbacks.publish).not.toHaveBeenCalled();
  });

  it('has no await between validation and publication and rejects duplicate terminal/mutation', async () => {
    const barrier = new ArchitectureRunMutationBarrier();
    let microtaskRan = false;
    const callbacks = terminal({ validateCurrent: () => {
      queueMicrotask(() => { microtaskRan = true; }); return 'bound';
    }, publish: (value) => { expect(value).toBe('bound'); expect(microtaskRan).toBe(false); } });
    await barrier.commitTerminal('run', callbacks);
    await expect(barrier.commitTerminal('run', callbacks)).rejects.toThrow('RUN_TERMINAL_PUBLISHED');
    expect(() => barrier.beginGoalMutation('run')).toThrow('RUN_TERMINAL_PUBLISHED');
  });

  it('releases pending intent and serial queue after a failed commit', async () => {
    const barrier = new ArchitectureRunMutationBarrier();
    const failed = barrier.beginGoalMutation('run');
    await expect(failed.commit(() => { throw new Error('operation failed'); })).rejects.toThrow('operation failed');
    expect(await barrier.beginGoalMutation('run').commit(() => 4)).toBe(4);
    await barrier.commitTerminal('run', terminal());
  });

  it.each(['validate', 'publish', 'stop'])('recovers queue after %s failure', async (kind) => {
    const barrier = new ArchitectureRunMutationBarrier();
    const fail = () => { throw new Error('failed'); };
    const operation = kind === 'stop' ? barrier.serializeStop('run', async () => fail())
      : barrier.commitTerminal('run', terminal(kind === 'validate' ? { validateCurrent: fail } : { publish: fail }));
    await expect(operation).rejects.toThrow('failed');
    const callbacks = terminal();
    await barrier.commitTerminal('run', callbacks);
    expect(callbacks.publish).toHaveBeenCalledOnce();
  });

  it('cancel is idempotent, cancelled/committed intents are single use', async () => {
    const barrier = new ArchitectureRunMutationBarrier();
    const cancelled = barrier.beginGoalMutation('run');
    cancelled.cancel(); cancelled.cancel();
    await expect(cancelled.commit(() => 1)).rejects.toThrow('GOAL_MUTATION_INTENT_USED');
    const used = barrier.beginGoalMutation('run');
    expect(await used.commit(() => 2)).toBe(2);
    used.cancel();
    await expect(used.commit(() => 3)).rejects.toThrow('GOAL_MUTATION_INTENT_USED');
    await barrier.commitTerminal('run', terminal());
  });

  it('cancel cannot release an already committing operation early', async () => {
    const barrier = new ArchitectureRunMutationBarrier();
    const gate = deferred();
    const intent = barrier.beginGoalMutation('run');
    const committed = intent.commit(() => gate.promise);
    intent.cancel();
    expect(() => barrier.retire('run')).toThrow('RUN_BARRIER_BUSY');
    gate.resolve(); await committed;
    barrier.retire('run');
  });

  it('failed preparation cancels pending intent without a write', async () => {
    const barrier = new ArchitectureRunMutationBarrier();
    const intent = barrier.beginGoalMutation('run');
    try { await Promise.reject(new Error('prepare failed')); }
    catch (error) { expect(error).toBeInstanceOf(Error); }
    finally { intent.cancel(); }
    await barrier.commitTerminal('run', terminal());
  });

  it('retire rejects pending, queued and executing work; idle retirement allows reuse', async () => {
    const barrier = new ArchitectureRunMutationBarrier();
    const intent = barrier.beginGoalMutation('run');
    expect(() => barrier.retire('run')).toThrow('RUN_BARRIER_BUSY'); intent.cancel();
    const gate = deferred(); const entered = deferred();
    const stop = barrier.serializeStop('run', async () => { entered.resolve(); await gate.promise; });
    expect(() => barrier.retire('run')).toThrow('RUN_BARRIER_BUSY');
    await entered.promise;
    expect(() => barrier.retire('run')).toThrow('RUN_BARRIER_BUSY');
    gate.resolve(); await stop;
    await barrier.commitTerminal('run', terminal()); barrier.retire('run');
    expect(await barrier.beginGoalMutation('run').commit(() => 'new generation')).toBe('new generation');
    barrier.retire('run'); barrier.retire('unknown');
  });

  it('rejects same-run reentrancy without deadlock, permits independent runs', async () => {
    const barrier = new ArchitectureRunMutationBarrier();
    await barrier.serializeStop('run', async () => {
      expect(() => barrier.beginGoalMutation('run')).toThrow('RUN_BARRIER_REENTRANT');
      await expect(barrier.serializeStop('run', async () => undefined)).rejects.toThrow('RUN_BARRIER_REENTRANT');
      await expect(barrier.commitTerminal('run', terminal())).rejects.toThrow('RUN_BARRIER_REENTRANT');
      expect(await barrier.beginGoalMutation('other').commit(() => 6)).toBe(6);
    });
    await barrier.commitTerminal('run', terminal());
  });
});
