import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentFlowRunSnapshot } from '@kalio/types';
import { AgentFlowRuntimeService } from './agent-flow-runtime.service';
import { AgentFlowRunRepository } from './agent-flow-run.repository';
import type { ArchitectureAgentFlowAdapter } from './architecture-agent-flow.adapter';

function fixture() {
  const snapshot: AgentFlowRunSnapshot = {
    run: { id: 'lifecycle-run', parentSessionId: 'parent', childSessionId: 'child',
      flowDefinitionId: 'test-flow', status: 'running', startMode: 'durable',
      returnMode: 'summary', createdAt: 1, updatedAt: 1 }, events: [],
  };
  const adapter = { start: vi.fn().mockResolvedValue(snapshot),
    getSnapshot: vi.fn().mockResolvedValue(snapshot), stop: vi.fn() };
  const repository = new AgentFlowRunRepository();
  const service = new AgentFlowRuntimeService(adapter as unknown as ArchitectureAgentFlowAdapter, repository);
  const start = () => service.start({ flowId: 'test-flow', goal: 'test', parentSessionId: 'parent' });
  return { service, adapter, repository, snapshot, start };
}

describe('AgentFlow reconciliation lifecycle', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

  it('clears scheduled callbacks on destroy without deleting durable pending state', async () => {
    const f = fixture();
    await f.start();
    expect(vi.getTimerCount()).toBe(1);
    f.service.onModuleDestroy();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(2000);
    expect(f.adapter.getSnapshot).not.toHaveBeenCalled();
    expect(f.repository.getSnapshot('lifecycle-run')?.run.status).toBe('running');
  });

  it('does not reschedule or persist a callback already awaiting the adapter when destroyed', async () => {
    const f = fixture();
    let resolve!: (snapshot: AgentFlowRunSnapshot) => void;
    f.adapter.getSnapshot.mockImplementation(() => new Promise<AgentFlowRunSnapshot>(done => { resolve = done; }));
    await f.start();
    await vi.advanceTimersByTimeAsync(1000);
    expect(f.adapter.getSnapshot).toHaveBeenCalledTimes(1);
    const save = vi.spyOn(f.repository, 'saveSnapshot');
    f.service.onModuleDestroy();
    resolve(f.snapshot);
    await vi.advanceTimersByTimeAsync(0);
    expect(save).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('continues reconciling before destroy and stops polling terminal snapshots', async () => {
    const f = fixture();
    await f.start();
    await vi.advanceTimersByTimeAsync(1000);
    expect(f.adapter.getSnapshot).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(1);
    f.adapter.getSnapshot.mockResolvedValue({ ...f.snapshot, run: { ...f.snapshot.run, status: 'done' } });
    await vi.advanceTimersByTimeAsync(1000);
    expect(f.repository.getSnapshot('lifecycle-run')?.run.status).toBe('done');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears all run timers and supports repeated destruction', async () => {
    const f = fixture();
    await f.start();
    f.adapter.start.mockResolvedValue({ ...f.snapshot, run: { ...f.snapshot.run, id: 'second-run' } });
    await f.start();
    expect(vi.getTimerCount()).toBe(2);
    f.service.onModuleDestroy();
    f.service.onModuleDestroy();
    await vi.advanceTimersByTimeAsync(3000);
    expect(vi.getTimerCount()).toBe(0);
    expect(f.adapter.getSnapshot).not.toHaveBeenCalled();
    expect(f.repository.getSnapshot('second-run')?.run.status).toBe('running');
  });

  it('does not schedule when a durable start resolves after destruction', async () => {
    const f = fixture();
    let resolve!: (snapshot: AgentFlowRunSnapshot) => void;
    f.adapter.start.mockImplementation(() => new Promise<AgentFlowRunSnapshot>(done => { resolve = done; }));
    const started = f.start();
    await vi.advanceTimersByTimeAsync(0);
    f.service.onModuleDestroy();
    resolve(f.snapshot);
    await started;
    expect(f.repository.getSnapshot('lifecycle-run')?.run.status).toBe('running');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('preserves durable cancellation and lets scheduled polling drain without another adapter read', async () => {
    const f = fixture();
    await f.start();
    await f.service.stop('lifecycle-run');
    await vi.advanceTimersByTimeAsync(1000);
    expect(f.adapter.stop).toHaveBeenCalledTimes(1);
    expect(f.adapter.getSnapshot).not.toHaveBeenCalled();
    expect(f.repository.getSnapshot('lifecycle-run')?.run.status).toBe('cancelled');
    expect(vi.getTimerCount()).toBe(0);
  });
});
