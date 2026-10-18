import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import * as schema from '../../database/schema';
import { DrizzleService } from '../../database/drizzle.service';
import { sessionTreeStopAdmission } from '../../database/session-tree-stop-admission';
import { CLIAgentSessionService } from '../cli-agent/cli-agent-session.service';
import { SessionEventsService } from './session-events.service';
import { SessionsService } from './sessions.service';

const clients: Database.Database[] = [];
afterEach(() => clients.splice(0).forEach(client => client.close()));

function fixture() {
  const client = new Database(':memory:'); clients.push(client);
  client.pragma('foreign_keys = ON');
  const db = drizzle(client, { schema });
  migrate(db, { migrationsFolder: resolve(__dirname, '../../database/migrations') });
  client.exec(`INSERT INTO personas(id,name,model,created_at,updated_at) VALUES ('p','Test','mock',1,1);
    INSERT INTO sessions(id,persona_id,parent_session_id,created_at,updated_at) VALUES
    ('root','p',NULL,1,1),('child','p','root',1,1);`);
  const database = Object.assign(Object.create(DrizzleService.prototype) as DrizzleService, { db });
  const chat = Object.create(SessionsService.prototype) as SessionsService;
  Object.assign(chat, {
    drizzle: database, sessionEvents: new SessionEventsService(),
  });
  const cli = new CLIAgentSessionService(database);
  return { client, db, chat, cli };
}

describe('both real session creation adapters honor topology freeze', () => {
  it('also guards the internal host-session reference used during project-scope preparation', async () => {
    const f = fixture();
    const claim = sessionTreeStopAdmission(f.db).claim('root');
    try {
      await expect(f.chat.create({ personaId: 'p', runtimeContext: {
        runtimeKind: 'chat', architectureContext: { hostSessionId: 'child' },
      } })).rejects.toThrow('SESSION_TREE_STOP_IN_PROGRESS');
      expect(f.client.prepare('SELECT count(*) AS n FROM sessions').get()).toEqual({ n: 2 });
    } finally { claim.release(); }
  });

  it.each(['chat', 'cli'] as const)('blocks %s child creation even when preparation started before claim', async adapter => {
    const f = fixture();
    const create = () => adapter === 'chat'
      ? f.chat.create({ personaId: 'p', parentSessionId: 'child', title: 'New child' })
      : f.cli.createChildSession({ parentSessionId: 'child', parentToolCallId: 'call', agentId: 'codex', title: 'New child' });
    const attempt = create().then(value => ({ value }), (error: unknown) => ({ error }));
    const claim = sessionTreeStopAdmission(f.db).claim('root');
    try {
      const result = await attempt;
      expect(result).toHaveProperty('error');
      if ('error' in result) expect(String(result.error)).toContain('SESSION_TREE_STOP_IN_PROGRESS');
      expect(f.client.prepare('SELECT count(*) AS n FROM sessions').get()).toEqual({ n: 2 });
    } finally { claim.release(); }
    const created = await create();
    expect(created.parentSessionId).toBe('child');
    expect(f.client.prepare('SELECT count(*) AS n FROM sessions').get()).toEqual({ n: 3 });
  });
});
