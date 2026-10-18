import { setImmediate } from 'node:timers/promises';
import { ConflictException } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { deferred, profileAdmissionFixture } from './session-profile-admission.fixture';

const fixtures: ReturnType<typeof profileAdmissionFixture>[] = [];
afterEach(async () => {
  fixtures.forEach(f => f.release.resolve());
  await setImmediate();
  vi.restoreAllMocks();
  fixtures.splice(0).forEach(f => f.client.close());
});
function fixture() { const f = profileAdmissionFixture(); fixtures.push(f); return f; }
const emit = () => undefined;

async function admission(f: ReturnType<typeof fixture>, kind: 'submit' | 'continuation' | 'resume') {
  if (kind === 'continuation') return f.pipeline.runContinuation('s', 'turn', async () => { await f.worker(); return true; });
  if (kind === 'resume') return f.pipeline.resumeQueuedSession('s', emit);
  return f.pipeline.submit({ sessionId: 's', personaId: 'old', content: 'Hello' }, emit);
}
async function seedQueue(f: ReturnType<typeof fixture>) {
  return f.journal.acceptQueuedRun({ sessionId: 's', turnId: 'queued', queueIdempotencyKey: 'queued',
    queuedPayload: { personaId: 'old', content: 'Queued' } });
}

describe('shared profile/admission boundary', () => {
  it.each(['submit', 'continuation', 'resume'] as const)('holds %s until an earlier profile mutation commits', async kind => {
    const f = fixture();
    if (kind === 'resume') await seedQueue(f);
    const read = deferred(); const releaseRead = deferred();
    const load = f.repo.loadHistory.bind(f.repo);
    vi.spyOn(f.repo, 'loadHistory').mockImplementationOnce(async id => {
      const history = await load(id); read.resolve(); await releaseRead.promise; return history;
    });
    const update = f.sessions.update('s', { executionProfileId: 'new' });
    await read.promise;
    const turn = admission(f, kind);
    try {
      await setImmediate();
      expect(f.registry.isActive('s')).toBe(false);
      expect(f.executed).toEqual([]);
    } finally { releaseRead.resolve(); }
    await update;
    await f.entered.promise;
    f.release.resolve(); await turn; await setImmediate();
    expect(f.executed).toEqual(['new']);
    expect((await f.sessions.get('s')).executionProfileId).toBe('new');
    expect(f.registry.isActive('s')).toBe(false);
  });

  it.each(['submit', 'continuation', 'resume'] as const)('rejects mutation while %s owns an empty session', async kind => {
    const f = fixture();
    if (kind === 'resume') await seedQueue(f);
    const turn = admission(f, kind);
    await f.entered.promise;
    expect(await f.repo.loadHistory('s')).toEqual([]);
    await expect(f.sessions.update('s', { executionProfileId: 'new' })).rejects.toThrow('generating');
    expect((await f.sessions.get('s')).executionProfileId).toBe('old');
    f.release.resolve(); await turn; await setImmediate();
    expect(f.executed).toEqual(['old']);
  });

  it('rejects changes after reservation but before startRun returns', async () => {
    const f = fixture(); const start = deferred(); const releaseStart = deferred();
    const original = f.journal.startRun.bind(f.journal);
    vi.spyOn(f.journal, 'startRun').mockImplementation(async input => {
      start.resolve(); await releaseStart.promise; return original(input);
    });
    const turn = admission(f, 'submit');
    await start.promise;
    try {
      expect(f.registry.isActive('s')).toBe(true);
      expect(await f.repo.loadHistory('s')).toEqual([]);
      await expect(f.sessions.update('s', { executionProfileId: 'new' })).rejects.toThrow('generating');
    } finally { releaseStart.resolve(); f.release.resolve(); }
    await turn;
    expect(f.executed).toEqual(['old']);
  });

  it('serializes persona-induced profile changes and validates the target profile', async () => {
    const f = fixture(); const read = deferred(); const releaseRead = deferred();
    const load = f.repo.loadHistory.bind(f.repo);
    vi.spyOn(f.repo, 'loadHistory').mockImplementationOnce(async id => {
      const history = await load(id); read.resolve(); await releaseRead.promise; return history;
    });
    const update = f.sessions.update('s', { personaId: 'new' });
    await read.promise;
    const turn = admission(f, 'submit');
    releaseRead.resolve(); await update;
    await f.entered.promise; f.release.resolve(); await turn;
    expect(f.executed).toEqual(['new']);
    expect(await f.sessions.get('s')).toMatchObject({ personaId: 'new', executionProfileId: 'new' });
  });

  it('rejects persona-induced rebind while a reserved session still has no history', async () => {
    const f = fixture();
    const turn = admission(f, 'submit'); await f.entered.promise;
    await expect(f.sessions.update('s', { personaId: 'new' })).rejects.toThrow('generating');
    expect(await f.sessions.get('s')).toMatchObject({ personaId: 'old', executionProfileId: 'old' });
    f.release.resolve(); await turn;
  });

  it('keeps reservations visible across queue advancement and emits queue callbacks outside admission', async () => {
    const f = fixture(); const first = admission(f, 'submit'); await f.entered.promise;
    let notified = false;
    await f.pipeline.submit({ sessionId: 's', personaId: 'old', content: 'Next' }, (event) => {
      if (event === 'chat:queued') f.gate.tryRunExclusive('s', () => { notified = true; });
    });
    expect(notified).toBe(true);
    f.release.resolve();
    await expect(f.sessions.update('s', { executionProfileId: 'new' })).rejects.toThrow('generating');
    await first;
    expect(f.executed).toEqual(['old', 'old']);
    expect(f.registry.isActive('s')).toBe(false);
    expect(f.pipeline.getSessionStatus('s').queueLength).toBe(0);
  });

  it('Stop invalidates a blocked mutation and an already-waiting submit without waiting for the gate', async () => {
    const f = fixture(); const read = deferred(); const releaseRead = deferred();
    const load = f.repo.loadHistory.bind(f.repo);
    vi.spyOn(f.repo, 'loadHistory').mockImplementationOnce(async id => {
      const history = await load(id); read.resolve(); await releaseRead.promise; return history;
    });
    const update = f.sessions.update('s', { executionProfileId: 'new' }).then(() => null, (error: unknown) => error);
    await read.promise;
    const errors: unknown[] = [];
    const turn = f.pipeline.submit({ sessionId: 's', personaId: 'old', content: 'Dropped' },
      (event, data) => { if (event === 'chat:error') errors.push(data); });
    await f.pipeline.stopAndDrain('s');
    releaseRead.resolve();
    expect(await update).toBeInstanceOf(ConflictException);
    await turn;
    expect(errors).toContainEqual(expect.objectContaining({ code: 'QUEUE_DROPPED' }));
    expect(f.executed).toEqual([]);
    expect((await f.sessions.get('s')).executionProfileId).toBe('old');
    await f.sessions.update('s', { executionProfileId: 'new' });
  });

  it('releases admission after failed validation and emits updates outside the gate', async () => {
    const f = fixture();
    await expect(f.sessions.update('s', { executionProfileId: 'missing' })).rejects.toThrow('not found');
    let callbackRan = false;
    f.events.onSessionUpdated(() => {
      f.gate.tryRunExclusive('s', () => { callbackRan = true; });
    });
    await f.sessions.update('s', { executionProfileId: 'new' });
    expect(callbackRan).toBe(true);
    expect((await f.sessions.get('s')).executionProfileId).toBe('new');
  });

  it('rejects an empty explicit profile instead of silently treating it as no change', async () => {
    const f = fixture();
    await expect(f.sessions.update('s', { executionProfileId: '' })).rejects.toThrow('not found');
    expect((await f.sessions.get('s')).executionProfileId).toBe('old');
    await f.sessions.update('s', { executionProfileId: 'new' });
  });

  it('commits before a Stop queued at the final SQL boundary, never after Stop observes the old binding', async () => {
    const f = fixture();
    let bindingAtStop: string | undefined;
    let stopped: Promise<void> | undefined;
    const originalUpdate = f.database.db.update.bind(f.database.db);
    vi.spyOn(f.database.db, 'update').mockImplementation(table => {
      const builder = originalUpdate(table);
      const originalSet = builder.set.bind(builder);
      vi.spyOn(builder, 'set').mockImplementation(values => {
        const query = originalSet(values);
        const originalWhere = query.where.bind(query);
        vi.spyOn(query, 'where').mockImplementation(condition => {
          const executable = originalWhere(condition);
          // The final guard already passed. Awaiting this query would yield
          // before SQLite executes it; .run() executes before this Stop.
          queueMicrotask(() => {
            bindingAtStop = (f.client.prepare('SELECT execution_profile_id AS id FROM sessions WHERE id = ?').get('s') as { id: string }).id;
            stopped = f.pipeline.stopAndDrain('s');
          });
          return executable;
        });
        return query;
      });
      return builder;
    });
    await f.sessions.update('s', { executionProfileId: 'new' });
    await stopped;
    expect(bindingAtStop).toBe('new');
    expect((await f.sessions.get('s')).executionProfileId).toBe(bindingAtStop);
  });

  it('rejects sync seed while asynchronous admission is queued but has not entered', async () => {
    const f = fixture();
    const queued = f.gate.runExclusive('s', async () => undefined);
    expect(() => f.pipeline.seedActiveTurn('s', 'too-early')).toThrow('SESSION_ADMISSION_BUSY');
    expect(f.registry.isActive('s')).toBe(false);
    expect(f.pipeline.getSessionStatus('s').active).toBe(false);
    await queued;
    f.pipeline.seedActiveTurn('s', 'after'); f.pipeline.clearSeededActiveTurn('s');
  });

  it('rejects a mutation initiated during an idle Stop lease, then allows it after release', async () => {
    const f = fixture();
    const lease = f.pipeline.acquireStopLease('s', Promise.resolve());
    await lease.ready;
    try {
      await expect(f.sessions.update('s', { executionProfileId: 'new' })).rejects.toThrow('SESSION_STOP_IN_PROGRESS');
      expect((await f.sessions.get('s')).executionProfileId).toBe('old');
    } finally { lease.release(); await lease.wait(); }
    await f.sessions.update('s', { executionProfileId: 'new' });
  });

  it('busy sync seed fails with no state change when a gate owner or waiter exists', async () => {
    const f = fixture(); const held = deferred(); const entered = deferred();
    const owner = f.gate.runExclusive('s', async () => { entered.resolve(); await held.promise; });
    await entered.promise;
    const queued = f.gate.runExclusive('s', async () => {
      expect(() => f.pipeline.seedActiveTurn('s', 'waiter')).toThrow('SESSION_ADMISSION_BUSY');
    });
    expect(() => f.pipeline.seedActiveTurn('s', 'held')).toThrow('SESSION_ADMISSION_BUSY');
    expect(f.pipeline.getSessionStatus('s')).toMatchObject({ active: false, queueLength: 0 });
    expect(f.registry.isActive('s')).toBe(false);
    held.resolve(); await Promise.all([owner, queued]);
    f.pipeline.seedActiveTurn('s', 'available');
    expect(f.registry.isActive('s')).toBe(true);
    f.pipeline.clearSeededActiveTurn('s');
    expect(f.registry.isActive('s')).toBe(false);
  });
});
