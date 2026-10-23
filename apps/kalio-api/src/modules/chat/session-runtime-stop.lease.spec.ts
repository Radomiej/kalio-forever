import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../../database/schema';
import { DrizzleService } from '../../database/drizzle.service';
import { ChatService } from './chat.service';
import { RunJournalService } from './run-journal.service';
import { HitlRequestService } from '../hitl/hitl-request.service';
import { SessionPipelineService } from './session-pipeline.service';
import { SessionProfileAdmissionService } from './session-profile-admission.service';
import { SessionRuntimeStopService } from './session-runtime-stop.service';
import { SessionsService } from './sessions.service';
import { SessionsController } from './sessions.controller';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

const clients: Database.Database[] = [];
afterEach(() => { vi.restoreAllMocks(); clients.splice(0).forEach(client => client.close()); });

function fixture() {
  const client = new Database(':memory:'); clients.push(client); client.pragma('foreign_keys = ON');
  const db = drizzle(client, { schema });
  migrate(db, { migrationsFolder: resolve(__dirname, '../../database/migrations') });
  client.exec(`INSERT INTO personas(id,name,model,created_at,updated_at) VALUES ('persona','Test','mock',1,1);
    INSERT INTO sessions(id,persona_id,created_at,updated_at) VALUES ('root','persona',1,1),('other','persona',1,1);
    INSERT INTO sessions(id,persona_id,parent_session_id,created_at,updated_at) VALUES ('child','persona','root',1,1);`);
  const database = Object.assign(Object.create(DrizzleService.prototype) as DrizzleService, { db });
  const sessions = Object.create(SessionsService.prototype) as SessionsService;
  Object.assign(sessions, { drizzle: database });
  const journal = new RunJournalService(database);
  const chat = Object.create(ChatService.prototype) as ChatService;
  Object.assign(chat, { hitlRequests: new HitlRequestService(database), runJournal: journal,
    abortControllers: new Map<string, AbortController>() });
  const pipeline = new SessionPipelineService(chat, journal, undefined, new SessionProfileAdmissionService());
  const coordinator = new SessionRuntimeStopService(sessions, pipeline);
  return { client, sessions, journal, chat, pipeline, coordinator };
}

describe('retained tree Stop lease (actual SQLite topology and cancellation)', () => {
  for (const phase of ['owner', 'delete action'] as const) {
    it.each([
      { name: 'Error', failure: new Error('Stop failed') },
      { name: 'undefined', failure: undefined }, { name: 'null', failure: null },
      { name: 'false', failure: false }, { name: 'zero', failure: 0 }, { name: 'empty string', failure: '' },
    ])(`rejects waiting submissions and coalesced Stop after ${phase} throws $name`, async ({ failure }) => {
      const f = fixture(); const entered = deferred(); const release = deferred();
      const execute = vi.spyOn(f.chat, 'handleTurn').mockResolvedValue(undefined);
      const action = vi.fn(async () => undefined);
      const settle = <T>(promise: Promise<T>) => promise.then(
        value => ({ status: 'fulfilled' as const, value }), error => ({ status: 'rejected' as const, error: error as unknown }));
      let stopping: ReturnType<typeof settle>;
      if (phase === 'owner') {
        const coordinator = new SessionRuntimeStopService(f.sessions, f.pipeline, undefined, undefined,
          { stopRunsForSessions: async () => { entered.resolve(); await release.promise; throw failure; } });
        stopping = settle(coordinator.withStoppedTree('root', action));
      } else {
        vi.spyOn(f.sessions, 'delete').mockImplementation(async () => {
          entered.resolve(); await release.promise; throw failure;
        });
        const controller = new SessionsController(f.sessions, f.journal, undefined as never, undefined as never, f.coordinator);
        stopping = settle(controller.delete('root'));
      }
      await entered.promise;
      const submissions = ['root', 'child'].map(sessionId => settle(f.pipeline.submit(
        { sessionId, personaId: 'persona', content: 'must not run after failed Stop' }, () => undefined)));
      const joinedStops = ['root', 'child'].map(id => settle(f.pipeline.stopAndDrain(id)));
      release.resolve();
      const stopped = await stopping;
      const waiting = await Promise.all([...submissions, ...joinedStops]);
      expect(stopped.status).toBe('rejected');
      if (stopped.status !== 'rejected') throw new Error('Expected Stop failure');
      if (phase === 'delete action') expect(stopped.error).toBe(failure);
      for (const result of waiting) expect(result).toEqual({ status: 'rejected', error: stopped.error });
      expect(execute).not.toHaveBeenCalled();
      expect(action).not.toHaveBeenCalled();
      expect(f.client.prepare('SELECT count(*) AS n FROM chat_runs').get()).toEqual({ n: 0 });
      // Failure is scoped to waiters of this lease; a fresh request may recover.
      await f.pipeline.submit({ sessionId: 'root', personaId: 'persona', content: 'fresh admission' }, () => undefined);
      expect(execute).toHaveBeenCalledTimes(1);
    });
  }

  it('admits a waiting submission after a successful action and shares its successful Stop result', async () => {
    const f = fixture(); const entered = deferred(); const release = deferred();
    const execute = vi.spyOn(f.chat, 'handleTurn').mockResolvedValue(undefined);
    const stopping = f.coordinator.withStoppedTree('root', async () => { entered.resolve(); await release.promise; });
    await entered.promise;
    const waiting = f.pipeline.submit({ sessionId: 'root', personaId: 'persona', content: 'after successful Stop' }, () => undefined);
    const joined = f.pipeline.stopAndDrain('root');
    expect(execute).not.toHaveBeenCalled();
    expect(() => f.pipeline.seedActiveTurn('child', 'during-action')).toThrow('stopping');
    release.resolve();
    await Promise.all([stopping, waiting, joined]);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('holds every fence and topology claim through the controller reverse-delete action', async () => {
    const f = fixture(); const entered = deferred(); const finishDelete = deferred();
    const remove = f.sessions.delete.bind(f.sessions); const deleted: string[] = [];
    vi.spyOn(f.sessions, 'delete').mockImplementation(async id => {
      if (id === 'child') { entered.resolve(); await finishDelete.promise; }
      await remove(id); deleted.push(id);
    });
    const controller = new SessionsController(f.sessions, f.journal, undefined as never, undefined as never, f.coordinator);
    const deleting = controller.delete('root');
    try {
      await entered.promise;
      for (const id of ['root', 'child']) {
        expect(() => f.pipeline.seedActiveTurn(id, 'gap-turn')).toThrow('stopping');
        await expect(f.coordinator.stopSessionTree(id)).rejects.toMatchObject({
          response: { code: 'SESSION_TREE_STOP_IN_PROGRESS' },
        });
      }
      // Another disjoint tree is not serialized behind the delete callback.
      await expect(f.coordinator.stopSessionTree('other')).resolves.toMatchObject({ rootSessionId: 'other' });
    } finally { finishDelete.resolve(); await deleting; }
    expect(deleted).toEqual(['child', 'root']);
    expect(f.client.prepare("SELECT id FROM sessions WHERE id IN ('root','child')").all()).toEqual([]);
    f.pipeline.seedActiveTurn('root', 'after-release');
    f.pipeline.clearSeededActiveTurn('root');
  });

  it('claims topology before asynchronous discovery, then fences a reservation admitted before discovery finishes', async () => {
    const f = fixture(); const entered = deferred(); const discovered = deferred();
    const children = f.sessions.listChildren.bind(f.sessions);
    vi.spyOn(f.sessions, 'listChildren').mockImplementation(async id => {
      if (id === 'root') { entered.resolve(); await discovered.promise; }
      return children(id);
    });
    const stopping = f.coordinator.stopSessionTree('root');
    try {
      await entered.promise;
      await expect(f.coordinator.stopSessionTree('child')).rejects.toMatchObject({ response: { code: 'SESSION_TREE_STOP_IN_PROGRESS' } });
      f.pipeline.seedActiveTurn('child', 'before-discovery');
    } finally { discovered.resolve(); }
    await stopping;
    expect(f.pipeline.getSessionStatus('child').active).toBe(false);
  });

  it('holds a child-scoped claim against an ancestor stop without expanding to the parent', async () => {
    const f = fixture(); const entered = deferred(); const release = deferred();
    const child = f.coordinator.withStoppedTree('child', async tree => {
      expect(tree.sessionIds).toEqual(['child']); entered.resolve(); await release.promise;
    });
    try {
      await entered.promise;
      await expect(f.coordinator.stopSessionTree('root')).rejects.toMatchObject({ response: { code: 'SESSION_TREE_STOP_IN_PROGRESS' } });
      f.pipeline.seedActiveTurn('root', 'parent-independent');
      f.pipeline.clearSeededActiveTurn('root');
    } finally { release.resolve(); await child; }
    await expect(f.coordinator.stopSessionTree('root')).resolves.toMatchObject({ rootSessionId: 'root' });
  });

  it.each(['root', 'child'])('rejects a weaker first standalone Stop on %s before acquiring any leases or starting owners', async weakId => {
    const f = fixture(); const entered = deferred(); const release = deferred();
    const cancel = f.chat.cancelPendingContinuations.bind(f.chat);
    vi.spyOn(f.chat, 'cancelPendingContinuations').mockImplementation(async id => {
      if (id === weakId) { entered.resolve(); await release.promise; }
      await cancel(id);
    });
    const weaker = f.pipeline.stopAndDrain(weakId); await entered.promise;
    const acquire = vi.spyOn(f.pipeline, 'acquireStopLease');
    const action = vi.fn(async () => undefined);
    const stopOwner = vi.fn(async () => []);
    const coordinator = new SessionRuntimeStopService(f.sessions, f.pipeline, undefined, undefined,
      { stopRunsForSessions: stopOwner });
    try {
      await expect(coordinator.withStoppedTree('root', action)).rejects.toThrow('SESSION_STOP_IN_PROGRESS');
      expect(action).not.toHaveBeenCalled();
      expect(stopOwner).not.toHaveBeenCalled();
      expect(acquire).not.toHaveBeenCalled();
    } finally { release.resolve(); await weaker; }
    await expect(f.coordinator.stopSessionTree('root')).resolves.toMatchObject({ rootSessionId: 'root' });
  });

  it('drains external writers before finalizing any partially acquired leases on an unexpected acquisition failure', async () => {
    const f = fixture(); const entered = deferred(); const drained = deferred(); const action = vi.fn(async () => undefined);
    const acquire = f.pipeline.acquireStopLease.bind(f.pipeline);
    vi.spyOn(f.pipeline, 'acquireStopLease').mockImplementation((id, barrier) => {
      if (id === 'child') throw new Error('unexpected acquisition failure');
      return acquire(id, barrier);
    });
    const finalize = vi.spyOn(f.chat, 'cancelPendingContinuations');
    const coordinator = new SessionRuntimeStopService(f.sessions, f.pipeline, undefined, undefined,
      { stopRunsForSessions: async () => { entered.resolve(); await drained.promise; return []; } });
    const result = coordinator.withStoppedTree('root', action).then(() => null, (error: unknown) => error);
    try {
      await entered.promise;
      expect(finalize).not.toHaveBeenCalled();
      expect(() => f.pipeline.seedActiveTurn('root', 'gap')).toThrow('stopping');
    } finally { drained.resolve(); }
    expect(String(await result)).toContain('unexpected acquisition failure');
    expect(action).not.toHaveBeenCalled();
    expect(finalize).toHaveBeenCalledWith('root');
    const claim = f.sessions.claimTreeStop('root'); claim.release();
    f.pipeline.seedActiveTurn('root', 'next'); f.pipeline.clearSeededActiveTurn('root');
  });

  it('minimizes selected parent and child roots while stopping disjoint trees exactly once', async () => {
    const f = fixture(); const stopOwner = vi.fn(async () => []);
    const coordinator = new SessionRuntimeStopService(f.sessions, f.pipeline, undefined, undefined,
      { stopRunsForSessions: stopOwner });
    await coordinator.stopSessionTrees(['child', 'root', 'other', 'root']);
    expect(stopOwner.mock.calls).toHaveLength(2);
    expect(stopOwner).toHaveBeenCalledWith(['root', 'child']);
    expect(stopOwner).toHaveBeenCalledWith(['other']);
  });

  it('settles disjoint selected roots and propagates a required owner ACK failure', async () => {
    const f = fixture(); const stopped: string[] = [];
    const coordinator = new SessionRuntimeStopService(f.sessions, f.pipeline, undefined, undefined,
      { stopRunsForSessions: async ids => {
        stopped.push(ids[0]!);
        if (ids[0] === 'root') throw new Error('required selected-root ACK');
        return [];
      } });
    await expect(coordinator.stopSessionTrees(['root', 'child', 'other'])).rejects.toThrow('required selected-root ACK');
    expect(stopped.sort()).toEqual(['other', 'root']);
    const claim = f.sessions.claimTreeStop('root'); claim.release();
  });

  it('does not ignore an external overlapping Stop when minimizing a selected batch', async () => {
    const f = fixture(); const entered = deferred(); const release = deferred();
    const held = f.coordinator.withStoppedTree('root', async () => { entered.resolve(); await release.promise; });
    try {
      await entered.promise;
      await expect(f.coordinator.stopSessionTrees(['root', 'child', 'other'])).rejects.toThrow('SESSION_TREE_STOP_IN_PROGRESS');
    } finally { release.resolve(); await held; }
    await expect(f.coordinator.stopSessionTree('root')).resolves.toMatchObject({ rootSessionId: 'root' });
  });

  it('aggregates owner and finalizer failures before action and releases every lease and claim', async () => {
    const f = fixture(); const action = vi.fn(async () => undefined);
    const cancel = f.chat.cancelPendingContinuations.bind(f.chat);
    vi.spyOn(f.chat, 'cancelPendingContinuations').mockImplementation(async id => {
      if (id === 'root') throw new Error('required cancellation ACK');
      await cancel(id);
    });
    const owner = { stopRunsForSessions: async () => { throw new Error('required architecture ACK'); } };
    const coordinator = new SessionRuntimeStopService(f.sessions, f.pipeline, undefined, undefined, owner);
    const error = await coordinator.withStoppedTree('root', action).then(() => null, (failure: unknown) => failure);
    expect(String(error)).toContain('required architecture ACK');
    expect(String(error)).toContain('required cancellation ACK');
    expect(action).not.toHaveBeenCalled();
    for (const id of ['root', 'child']) { f.pipeline.seedActiveTurn(id, 'next'); f.pipeline.clearSeededActiveTurn(id); }
    const claim = f.sessions.claimTreeStop('root'); claim.release();
  });

  it('releases all fences and the topology claim when the action throws', async () => {
    const f = fixture(); const error = new Error('delete failed');
    await expect(f.coordinator.withStoppedTree('root', async () => { throw error; })).rejects.toBe(error);
    await expect(f.coordinator.stopSessionTree('root')).resolves.toMatchObject({ rootSessionId: 'root' });
    f.pipeline.seedActiveTurn('child', 'next'); f.pipeline.clearSeededActiveTurn('child');
  });
});
