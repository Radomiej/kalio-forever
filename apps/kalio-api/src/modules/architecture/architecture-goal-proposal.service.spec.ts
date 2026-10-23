import { describe, expect, it, vi } from 'vitest';
import { ArchitectureGoalProposalService } from './architecture-goal-proposal.service';
import { createGoalPacket } from './architecture-goal-source';
import type { ArchitectureGoalState } from './architecture-goal.repository';
import { ArchitectureGoalRepository } from './architecture-goal.repository';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { resolve } from 'node:path';
import type { DrizzleService } from '../../database/drizzle.service';
import * as schema from '../../database/schema';

function fixture() {
  let state: ArchitectureGoalState = { runId: 'run', rootSessionId: 'root', stateRevision: 1,
    createdAt: 1, updatedAt: 1, evidenceInventory: null, completionAuthorization: null,
    packet: createGoalPacket({ sessionId: 'host', messageId: 'message', turnId: 'turn', content: 'Build site', createdAt: 1 }) };
  const hydrate = vi.fn(() => structuredClone(state));
  const load = vi.fn(() => structuredClone(state));
  const compareAndSwap = vi.fn((_run: string, revision: number, next: { packet: ArchitectureGoalState['packet']; updatedAt: number }) => {
    if (revision !== state.stateRevision) throw new Error('conflict');
    state = { ...state, ...next, stateRevision: revision + 1 };
    return structuredClone(state);
  });
  const persistRequired = vi.fn(async (): Promise<void> => undefined);
  const service = new ArchitectureGoalProposalService({ hydrate }, { load, compareAndSwap }, { persistRequired });
  const run = { id: 'run', rootSessionId: 'root', schemaId: 'schema' };
  const raw = { sourceVersion: 1, criteria: [{ text: 'Build site', sourceQuotes: [{ messageId: 'message', quote: 'Build site' }], supersedes: [] }] };
  return { service, run, raw, hydrate, load, compareAndSwap, persistRequired,
    get state() { return state; }, set state(value) { state = value; } };
}

describe('ArchitectureGoalProposalService', () => {
  it('recovers the proposal through a fresh SQLite repository instance', async () => {
    const client = new Database(':memory:');
    try {
      const db = drizzle(client, { schema });
      migrate(db, { migrationsFolder: resolve(process.cwd(), 'src/database/migrations') });
      const dependency = { db } as unknown as DrizzleService;
      const repository = new ArchitectureGoalRepository(dependency);
      const f = fixture();
      repository.create(f.state);
      const service = new ArchitectureGoalProposalService({ hydrate: (runId, root) => repository.load(runId, root) },
        repository, { persistRequired: async () => undefined });
      const saved = await service.record(f.run, f.raw, 1);
      const reopened = new ArchitectureGoalRepository(dependency).load('run', 'root');
      expect(reopened).toEqual(saved);
      expect(reopened?.packet.projection).toMatchObject({ status: 'pending', proposal: { sourceVersion: 1 } });
      expect(reopened?.completionAuthorization).toBeNull();
    } finally { client.close(); }
  });
  it('stores validated proposal and awaits audit before returning detached state', async () => {
    const f = fixture();
    let acknowledge!: () => void;
    f.persistRequired.mockImplementation(() => new Promise<void>(resolve => { acknowledge = resolve; }));
    let returned = false;
    const task = f.service.record(f.run, f.raw, 1).then(state => { returned = true; return state; });
    await Promise.resolve();
    expect(returned).toBe(false);
    expect(f.state.packet.projection).toMatchObject({ status: 'pending', proposal: { sourceVersion: 1 } });
    acknowledge();
    const result = await task;
    expect(result.stateRevision).toBe(2);
    result.packet.original.content = 'changed';
    expect(f.state.packet.original.content).toBe('Build site');
  });
  it.each([0, 2, Number.NaN])('rejects revision %s before writes', async revision => {
    const f = fixture();
    await expect(f.service.record(f.run, f.raw, revision)).rejects.toThrow('GOAL_PROPOSAL_FAILED');
    expect(f.compareAndSwap).not.toHaveBeenCalled();
  });
  it('rejects worker policy injection before writes', async () => {
    const f = fixture();
    await expect(f.service.record(f.run, { ...f.raw, completionPolicy: {} }, 1)).rejects.toThrow('GOAL_PROPOSAL_FAILED');
    expect(f.compareAndSwap).not.toHaveBeenCalled();
  });
  it('does not return a receipt when audit fails', async () => {
    const f = fixture();
    f.persistRequired.mockRejectedValue(new Error('secret driver text'));
    await expect(f.service.record(f.run, f.raw, 1)).rejects.toThrow(/^GOAL_PROPOSAL_FAILED$/);
    expect(f.state.stateRevision).toBe(2);
  });
  it('rejects changed revision during audit acknowledgement', async () => {
    const f = fixture();
    f.persistRequired.mockImplementation(async () => { f.state = { ...f.state, stateRevision: 3 }; });
    await expect(f.service.record(f.run, f.raw, 1)).rejects.toThrow('GOAL_PROPOSAL_FAILED');
  });
  it('does not write when already aborted', async () => {
    const f = fixture(); const controller = new AbortController(); controller.abort();
    await expect(f.service.record(f.run, f.raw, 1, controller.signal)).rejects.toThrow('GOAL_PROPOSAL_FAILED');
    expect(f.compareAndSwap).not.toHaveBeenCalled();
  });
  it('does not return permission when stopped during acknowledgement', async () => {
    const f = fixture(); const controller = new AbortController();
    f.persistRequired.mockImplementation(async () => { controller.abort(); });
    await expect(f.service.record(f.run, f.raw, 1, controller.signal)).rejects.toThrow('GOAL_PROPOSAL_FAILED');
  });
});
