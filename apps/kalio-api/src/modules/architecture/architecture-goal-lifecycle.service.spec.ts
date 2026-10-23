import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ArchitectureGoalSourceV1 } from '@kalio/types';
import type { DrizzleService } from '../../database/drizzle.service';
import * as schema from '../../database/schema';
import { ArchitectureGoalRepository } from './architecture-goal.repository';
import { ArchitectureGoalLifecycleService, type ArchitectureGoalSourceReadPort } from './architecture-goal-lifecycle.service';

const clients: Database.Database[] = [];
afterEach(() => clients.splice(0).forEach(client => client.close()));
const original: ArchitectureGoalSourceV1 = { messageId: 'prompt', sessionId: 'source-chat', turnId: 'turn', content: ' Original\n', createdAt: 100 };
const locator = { sessionId: original.sessionId, messageId: original.messageId, turnId: original.turnId };
function fixture() {
  const client = new Database(':memory:');
  clients.push(client);
  const db = drizzle(client, { schema });
  migrate(db, { migrationsFolder: resolve(__dirname, '../../database/migrations') });
  const repo = new ArchitectureGoalRepository({ db } as unknown as DrizzleService);
  const read = vi.fn<ArchitectureGoalSourceReadPort['read']>(async () => structuredClone(original));
  const lifecycle = new ArchitectureGoalLifecycleService(repo, { read });
  return { repo, lifecycle, read };
}

describe('ArchitectureGoalLifecycleService with real SQLite goal repository', () => {
  it('creates from the reader without confusing source session and internal root ownership', async () => {
    const { lifecycle, repo, read } = fixture();
    const state = await lifecycle.create('run', 'arch-root', locator);
    expect(read).toHaveBeenCalledExactlyOnceWith(locator);
    expect(state.stateRevision).toBe(1);
    expect(state.packet.original).toEqual(original);
    expect(state.rootSessionId).toBe('arch-root');
    expect(lifecycle.hydrate('run', 'arch-root', true)).toEqual(repo.load('run', 'arch-root'));
    expect(() => lifecycle.hydrate('run', 'wrong-root', false)).toThrow('GOAL_STATE_OWNERSHIP');
  });
  it('never replaces an original on repeated create', async () => {
    const { lifecycle, repo, read } = fixture();
    await lifecycle.create('run', 'root', locator);
    read.mockResolvedValue({ ...original, content: 'Overwrite secret' });
    await expect(lifecycle.create('run', 'root', locator)).rejects.toThrow('GOAL_STATE_CONFLICT');
    expect(repo.load('run')!.packet.original).toEqual(original);
  });
  it('appends once through CAS and returns identical duplicates without CAS/revision increment', async () => {
    const { lifecycle, repo, read } = fixture();
    await lifecycle.create('run', 'root', locator);
    const next = { ...original, messageId: 'next', turnId: 'next-turn', content: ' Update\n', createdAt: 200 };
    const nextLocator = { sessionId: next.sessionId, messageId: next.messageId, turnId: next.turnId };
    read.mockResolvedValue(next);
    const cas = vi.spyOn(repo, 'compareAndSwap');
    read.mockResolvedValue(null);
    await expect(lifecycle.append('run', 'root', locator, 1)).rejects.toThrow(/^GOAL_SOURCE_INVALID\.$/);
    read.mockResolvedValue(next);
    const state = await lifecycle.append('run', 'root', nextLocator, 1);
    expect(state.stateRevision).toBe(2);
    expect(state.packet.version).toBe(2);
    expect(state.packet.original).toEqual(original);
    expect(state.packet.updates).toEqual([next]);
    expect(cas).toHaveBeenCalledTimes(1);
    await expect(lifecycle.append('run', 'root', nextLocator, 2)).resolves.toEqual(state);
    expect(cas).toHaveBeenCalledTimes(1);
    await expect(lifecycle.append('run', 'root', nextLocator, 1)).rejects.toThrow('GOAL_STATE_CONFLICT');
    expect(cas).toHaveBeenCalledTimes(1);
  });
  it('fails closed for a missing required row and does not recreate during hydration', () => {
    const { lifecycle, repo } = fixture();
    const create = vi.spyOn(repo, 'create');
    expect(lifecycle.hydrate('absent', 'root', false)).toBeNull();
    expect(() => lifecycle.hydrate('absent', 'root', true)).toThrow(/^GOAL_STATE_MISSING\.$/);
    expect(create).not.toHaveBeenCalled();
  });
  it('rejects null, forged locator results and foreign source sessions before writes', async () => {
    const { lifecycle, repo, read } = fixture();
    await lifecycle.create('run', 'root', locator);
    const cas = vi.spyOn(repo, 'compareAndSwap');
    read.mockResolvedValue({ ...original, messageId: 'wrong' });
    await expect(lifecycle.append('run', 'root', locator, 1)).rejects.toThrow(/^GOAL_SOURCE_INVALID\.$/);
    read.mockResolvedValue({ ...original, sessionId: 'child', messageId: 'next' });
    await expect(lifecycle.append('run', 'root', { ...locator, sessionId: 'child', messageId: 'next' }, 1)).rejects.toThrow(/^GOAL_SOURCE_INVALID\.$/);
    expect(cas).not.toHaveBeenCalled();
    expect(repo.load('run')!.stateRevision).toBe(1);
  });
  it('rejects malformed admission and does not leak reader errors', async () => {
    const { lifecycle, repo, read } = fixture();
    const create = vi.spyOn(repo, 'create');
    read.mockResolvedValue({ ...original, content: '' });
    await expect(lifecycle.create('run', 'root', locator)).rejects.toThrow(/^GOAL_SOURCE_INVALID\.$/);
    read.mockRejectedValue(new Error('Original secret SQL'));
    await expect(lifecycle.create('run', 'root', locator)).rejects.toThrow(/^GOAL_SOURCE_READ_ERROR\.$/);
    expect(create).not.toHaveBeenCalled();
  });
  it('surfaces a racing CAS conflict without retries or merging', async () => {
    const { lifecycle, repo, read } = fixture();
    await lifecycle.create('run', 'root', locator);
    read.mockResolvedValue({ ...original, messageId: 'next' });
    const cas = vi.spyOn(repo, 'compareAndSwap').mockImplementation(() => { throw new Error('GOAL_STATE_CONFLICT'); });
    await expect(lifecycle.append('run', 'root', { ...locator, messageId: 'next' }, 1)).rejects.toThrow('GOAL_STATE_CONFLICT');
    expect(cas).toHaveBeenCalledTimes(1);
    expect(repo.load('run')!.packet.version).toBe(1);
  });
  it('admits only one concurrent append for the same revision with no lost update', async () => {
    const { lifecycle, repo, read } = fixture();
    await lifecycle.create('run', 'root', locator);
    read.mockImplementation(async input => ({ ...original, ...input, content: input.messageId }));
    const outcomes = await Promise.allSettled([
      lifecycle.append('run', 'root', { ...locator, messageId: 'a' }, 1),
      lifecycle.append('run', 'root', { ...locator, messageId: 'b' }, 1),
    ]);
    expect(outcomes.filter(outcome => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter(outcome => outcome.status === 'rejected')).toHaveLength(1);
    expect(repo.load('run')!.stateRevision).toBe(2);
    expect(repo.load('run')!.packet.updates).toHaveLength(1);
  });
});
