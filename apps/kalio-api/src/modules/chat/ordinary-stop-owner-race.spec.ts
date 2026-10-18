import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { resolve } from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../../database/schema';
import { DrizzleService } from '../../database/drizzle.service';
import { HitlRequestService } from '../hitl/hitl-request.service';
import { ChatService } from './chat.service';
import { RunJournalService } from './run-journal.service';
import { SessionPipelineService } from './session-pipeline.service';
import { SessionRuntimeStopService } from './session-runtime-stop.service';
import { ActiveSubagentRunRegistry } from './subagent-runtime.support';
import { sessionTreeStopAdmission } from '../../database/session-tree-stop-admission';

const clients: Database.Database[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  clients.splice(0).forEach(client => client.close());
});

function fixture() {
  const client = new Database(':memory:');
  clients.push(client);
  client.pragma('foreign_keys = ON');
  const db = drizzle(client, { schema });
  migrate(db, { migrationsFolder: resolve(__dirname, '../../database/migrations') });
  client.exec(`INSERT INTO personas(id,name,model,created_at,updated_at) VALUES ('persona','Test','mock',1,1);
    INSERT INTO sessions(id,persona_id,created_at,updated_at) VALUES ('role-session','persona',1,1);`);
  const database = Object.assign(Object.create(DrizzleService.prototype) as DrizzleService, { db });
  const journal = new RunJournalService(database);
  const requests = new HitlRequestService(database);
  const chat = Object.create(ChatService.prototype) as ChatService;
  Object.assign(chat, {
    runJournal: journal, hitlRequests: requests, abortControllers: new Map<string, AbortController>(),
  });
  return { client, db, journal, requests, chat };
}

async function finishOwner(journal: RunJournalService, id: string, terminal: 'failed' | 'completed') {
  if (terminal === 'failed') await journal.fail(id, 'UNKNOWN', 'Sub-agent stopped because its session tree was stopped.');
  else await journal.complete(id, { finalText: 'Role completed before cancellation.' });
}

describe('ordinary Stop versus independent journal owner (migrated SQLite)', () => {
  it.each(['failed', 'completed'] as const)('characterizes stale active read -> owner %s -> real CAS conflict', async terminal => {
    const f = fixture();
    const run = await f.journal.startRun({ sessionId: 'role-session', turnId: 'role-turn' });
    const read = f.journal.getCurrentRun.bind(f.journal);
    vi.spyOn(f.journal, 'getCurrentRun').mockImplementationOnce(async sessionId => {
      const snapshot = await read(sessionId);
      expect(snapshot).toMatchObject({ id: run.id, status: 'active', revision: 1 });
      // Real writer used by SubagentRuntimeService catch / completeSubagentRuntime.
      await finishOwner(f.journal, run.id, terminal);
      return snapshot;
    });

    await expect(f.chat.cancelPendingContinuations('role-session')).rejects.toThrow('ORDINARY_CANCELLATION_CONFLICT');
    expect(f.client.prepare('SELECT status,revision FROM chat_runs WHERE id=?').get(run.id))
      .toEqual({ status: terminal, revision: 2 });
    expect(await f.requests.listPending('role-session')).toEqual([]);
    expect(f.client.prepare('SELECT count(*) AS n FROM messages').get()).toEqual({ n: 0 });
  });

  it.each(['failed', 'completed'] as const)('drains the %s journal owner before final cancellation without deadlock', async terminal => {
    const f = fixture();
    const run = await f.journal.startRun({ sessionId: 'role-session', turnId: 'role-turn' });
    const registry = new ActiveSubagentRunRegistry();
    const controller = new AbortController();
    const finish = registry.register({ childSessionId: 'role-session', parentSessionId: 'host-session',
      historySessionId: 'role-session', vfsSessionId: 'role-session', turnId: 'role-turn', controller });
    let ownerQuiescent = false;
    let cancellationBeforeQuiescence = false;
    const ownerDone = new Promise<void>((resolveOwner, rejectOwner) => {
      controller.signal.addEventListener('abort', () => {
        // Advance one event-loop turn, not a timed sleep: every ready pipeline
        // microtask can run before the independent owner writes its terminal row.
        void setImmediate().then(async () => {
          try {
            await finishOwner(f.journal, run.id, terminal);
            ownerQuiescent = true;
            resolveOwner();
          } catch (error) {
            rejectOwner(error);
          } finally {
            finish();
          }
        });
      }, { once: true });
    });
    const read = f.journal.getCurrentRun.bind(f.journal);
    vi.spyOn(f.journal, 'getCurrentRun').mockImplementation(async sessionId => {
      const snapshot = await read(sessionId);
      if (!ownerQuiescent) {
        cancellationBeforeQuiescence = true;
        expect(snapshot).toMatchObject({ id: run.id, status: 'active', revision: 1 });
        await ownerDone;
      }
      return snapshot;
    });
    const pipeline = new SessionPipelineService(f.chat, f.journal);
    const stop = new SessionRuntimeStopService({
      claimTreeStop: (id: string) => sessionTreeStopAdmission(f.db).claim(id),
      listChildren: async () => [],
      get: async () => ({ id: 'role-session', personaId: 'persona', createdAt: 1, updatedAt: 1 }),
    } as never, pipeline, undefined, undefined, undefined, {
      runSubagent: async () => { throw new Error('No live execution in this regression.'); },
      stopAndDrainSessions: sessionIds => registry.stopAndDrainSessions(sessionIds),
    });

    // Observe rejection immediately; no unhandled rejection is used as evidence.
    const result = await stop.stopSessionTree('role-session').then(() => null, (error: unknown) => error);
    await ownerDone;
    expect(controller.signal.aborted).toBe(true);
    expect(registry.getStatus('role-session')).toBeNull();
    expect(f.client.prepare('SELECT status,revision FROM chat_runs WHERE id=?').get(run.id))
      .toEqual({ status: terminal, revision: 2 });
    expect(result, 'Stop must await the journal owner before ordinary cancellation').toBeNull();
    expect(cancellationBeforeQuiescence).toBe(false);
  });
});
