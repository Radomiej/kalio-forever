import { describe, expect, it, vi } from 'vitest';
import { RuntimeExecutionScheduler } from './runtime-execution.scheduler';

describe('RuntimeExecutionScheduler', () => {
  it('keeps at most five runnable executions active', async () => {
    const scheduler = new RuntimeExecutionScheduler({ maxConcurrentExecutions: 5 });
    const releases: Array<() => void> = [];

    const leases = await Promise.all(
      Array.from({ length: 5 }, (_, index) => scheduler.acquire({
        projectId: `project-${index}`,
        priority: 'foreground',
        label: `turn-${index}`,
      })),
    );

    const sixth = scheduler.acquire({
      projectId: 'project-6',
      priority: 'foreground',
      label: 'turn-6',
    });

    expect(scheduler.activeCount).toBe(5);
    expect(scheduler.queuedCount).toBe(1);

    leases.forEach((lease) => releases.push(() => lease.release()));
    releases[0]?.();

    await expect(sixth).resolves.toMatchObject({ projectId: 'project-6' });
    expect(scheduler.activeCount).toBe(5);

    leases.slice(1).forEach((lease) => lease.release());
    const sixthLease = await sixth;
    sixthLease.release();
    expect(scheduler.activeCount).toBe(0);
  });

  it('serves control-plane work before foreground work already queued', async () => {
    const scheduler = new RuntimeExecutionScheduler({ maxConcurrentExecutions: 1 });
    const first = await scheduler.acquire({ projectId: 'project-a', priority: 'foreground', label: 'first' });
    const order: string[] = [];
    const foreground = scheduler.acquire({ projectId: 'project-a', priority: 'foreground', label: 'foreground' });
    const control = scheduler.acquire({ projectId: 'project-b', priority: 'control', label: 'resume' });

    first.release();
    const controlLease = await control;
    order.push(controlLease.label);
    controlLease.release();
    const foregroundLease = await foreground;
    order.push(foregroundLease.label);
    foregroundLease.release();

    expect(order).toEqual(['resume', 'foreground']);
  });

  it('round-robins foreground work between projects while preserving each project FIFO', async () => {
    const scheduler = new RuntimeExecutionScheduler({ maxConcurrentExecutions: 1 });
    const first = await scheduler.acquire({ projectId: 'project-a', priority: 'foreground', label: 'a-1' });
    const a2 = scheduler.acquire({ projectId: 'project-a', priority: 'foreground', label: 'a-2' });
    const b1 = scheduler.acquire({ projectId: 'project-b', priority: 'foreground', label: 'b-1' });

    first.release();
    const firstNext = await b1;
    firstNext.release();
    const secondNext = await a2;
    secondNext.release();

    expect(firstNext.label).toBe('b-1');
    expect(secondNext.label).toBe('a-2');
  });

  it('releases a lease only once', async () => {
    const scheduler = new RuntimeExecutionScheduler({ maxConcurrentExecutions: 1 });
    const lease = await scheduler.acquire({ projectId: 'project-a', priority: 'foreground', label: 'turn' });
    const onRelease = vi.fn();
    lease.onRelease(onRelease);

    lease.release();
    lease.release();

    expect(onRelease).toHaveBeenCalledTimes(1);
    expect(scheduler.activeCount).toBe(0);
  });

  it('runs an operation under a permit and releases it after failure', async () => {
    const scheduler = new RuntimeExecutionScheduler({ maxConcurrentExecutions: 1 });

    await expect(scheduler.run(
      { projectId: 'project-a', priority: 'foreground', label: 'turn' },
      async (lease) => {
        expect(lease.label).toBe('turn');
        expect(scheduler.activeCount).toBe(1);
        throw new Error('operation failed');
      },
    )).rejects.toThrow('operation failed');

    expect(scheduler.activeCount).toBe(0);
  });
});
