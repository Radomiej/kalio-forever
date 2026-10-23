import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { resolve } from 'node:path';
import * as schema from '../../database/schema';
import { DrizzleService } from '../../database/drizzle.service';
import { ExecutionProfileService } from '../agent-runtime/execution-profile.service';
import { PersonaService } from '../persona/persona.service';
import type { ChatService } from './chat.service';
import { ActiveSessionRegistry } from './active-session-registry.service';
import { DrizzleMessageRepository } from './drizzle-message.repository';
import { RunJournalService } from './run-journal.service';
import { SessionEventsService } from './session-events.service';
import { SessionPipelineService } from './session-pipeline.service';
import { SessionProfileAdmissionService } from './session-profile-admission.service';
import { SessionsService } from './sessions.service';

export function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

/** Real persistence/admission; worker double exposes reservation before dispatch. */
export function profileAdmissionFixture(): {
  client: Database.Database; database: DrizzleService; sessions: SessionsService;
  repo: DrizzleMessageRepository; registry: ActiveSessionRegistry; gate: SessionProfileAdmissionService;
  profiles: ExecutionProfileService; journal: RunJournalService; pipeline: SessionPipelineService;
  worker: () => Promise<void>; entered: ReturnType<typeof deferred>; release: ReturnType<typeof deferred>;
  executed: (string | undefined)[]; events: SessionEventsService;
} {
  const client: Database.Database = new Database(':memory:');
  client.pragma('foreign_keys = ON');
  const db = drizzle(client, { schema });
  migrate(db, { migrationsFolder: resolve(__dirname, '../../database/migrations') });
  const now = new Date();
  db.insert(schema.executionProfiles).values(['old', 'new'].map(id => ({
    id, name: id, kind: 'direct-llm' as const, provider: 'openai' as const, model: id,
    enabled: true, createdAt: now, updatedAt: now,
  }))).run();
  db.insert(schema.personas).values(['old', 'new'].map(id => ({
    id, name: id, model: id, executionProfileId: id, createdAt: now, updatedAt: now,
  }))).run();
  db.insert(schema.sessions).values({ id: 's', personaId: 'old', executionProfileId: 'old', createdAt: now, updatedAt: now }).run();
  const database = Object.create(DrizzleService.prototype) as DrizzleService;
  Object.assign(database, { db });
  const events = new SessionEventsService();
  const repo = new DrizzleMessageRepository(database, events);
  const registry = new ActiveSessionRegistry();
  const gate = new SessionProfileAdmissionService();
  const profiles = new ExecutionProfileService(database);
  const personas = Object.create(PersonaService.prototype) as PersonaService;
  Object.assign(personas, { drizzle: database });
  const sessions = Object.create(SessionsService.prototype) as SessionsService;
  Object.assign(sessions, { drizzle: database, repo, sessionEvents: events,
    executionProfiles: profiles, personas, activeSessionRegistry: registry, profileAdmission: gate });
  const journal = new RunJournalService(database);
  const entered = deferred();
  const release = deferred();
  const executed: (string | undefined)[] = [];
  const worker = async () => {
    entered.resolve();
    await release.promise;
    executed.push((await sessions.get('s')).executionProfileId);
  };
  const chat = { handleTurn: worker, abort: () => undefined,
    cancelPendingContinuations: async () => undefined } as unknown as ChatService;
  const pipeline = new SessionPipelineService(chat, journal, registry, gate);
  return { client, database, sessions, repo, registry, gate, profiles, journal, pipeline,
    worker, entered, release, executed, events };
}
