import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ArchitectureSchema, CreateSessionDto, ExecutionProfile } from '@kalio/types';
import * as schema from '../../database/schema';
import { DrizzleService } from '../../database/drizzle.service';
import { resolveExecutionProfileId } from '../agent-runtime/execution-profile.utils';
import { sessionTreeStopAdmission } from '../../database/session-tree-stop-admission';
import { SessionsService } from './sessions.service';
import { SessionEventsService } from './session-events.service';
import { SessionProfileAdmissionService } from './session-profile-admission.service';
import { prepareSubagentExecution } from './subagent-execution-scope';
import type { ExecutionProfileService } from '../agent-runtime/execution-profile.service';

const clients: Database.Database[] = [];
afterEach(() => clients.splice(0).forEach(db => db.close()));
async function fixture() {
  const client = new Database(':memory:'); clients.push(client); client.pragma('foreign_keys=ON');
  const db = drizzle(client, { schema }); migrate(db, { migrationsFolder: resolve(__dirname, '../../database/migrations') });
  for (const id of ['sol', 'swe', 'flash']) {
    client.prepare('INSERT INTO personas(id,name,model,created_at,updated_at) VALUES (?,?,?,1,1)').run(id, id, '');
  }
  const profileMap = {
    sol: { id: 'sol', kind: 'codex-app-server', model: 'gpt-6.1-sol' },
    swe: { id: 'swe', kind: 'devin-cli-acp', model: 'swe-2-high' },
    flash: { id: 'flash', kind: 'devin-cli-acp', model: 'swe-2-flash-medium' },
  };
  const profiles = { getDefaultId: async () => 'sol', resolveId: resolveExecutionProfileId,
    assertEnabled: async (id: string) => {
      if (!(id in profileMap)) throw new Error('Unavailable profile');
      return profileMap[id as keyof typeof profileMap] as ExecutionProfile;
    } };
  const sessions: SessionsService = Object.create(SessionsService.prototype) as SessionsService;
  Object.assign(sessions, {
    drizzle: Object.assign(Object.create(DrizzleService.prototype) as DrizzleService, { db }),
    sessionEvents: new SessionEventsService(), executionProfiles: profiles,
    personas: { getSessionConfig: async (id: string) => ({ executionProfileId: id }) },
    profileAdmission: new SessionProfileAdmissionService(),
  });
  await sessions.createWithId('root', { personaId: 'sol', executionProfileId: 'sol',
    runtimeContext: { runtimeKind: 'agent-flow-root', architectureContext: { architectureRunId: 'run', schemaId: 'mixed' } } });
  const runtimeSchema = { id: 'mixed', roleSlots: ['sol', 'swe', 'flash'].map(id => ({ id, defaultPersonaId: id })) } as Pick<ArchitectureSchema, 'id' | 'roleSlots'>;
  const dto = (personaId: string): CreateSessionDto => ({ personaId, kind: 'subagent', parentSessionId: 'root',
    runtimeContext: { runtimeKind: 'agent-flow-branch', parentSessionId: 'root', architectureSlotId: personaId,
      architectureContext: { architectureRunId: 'run', schemaId: 'mixed', roleSlotId: personaId } } });
  const create = (personaId: string) => sessions.createWithId('child-' + personaId, dto(personaId), { architectureBranch: {
    rootSessionId: 'root', runId: 'run', schema: runtimeSchema, slotId: personaId, personaId, goalProtocol: false,
  } });
  return { db, sessions, profiles, dto, create };
}

describe('real SQLite mixed architecture profiles', () => {
  it('persists each role profile and runtime resolution consumes that exact profile after reload', async () => {
    const f = await fixture();
    for (const id of ['sol', 'swe', 'flash']) {
      await f.create(id);
      const child = await f.sessions.get('child-' + id);
      expect(child.executionProfileId).toBe(id); expect(child.externalThreadId).toBeUndefined();
      const prepared = await prepareSubagentExecution({ sessions: f.sessions, executionProfiles: f.profiles as unknown as ExecutionProfileService,
        requestedChildSessionId: child.id, childSessionId: child.id, personaId: id, objective: 'Work',
        parentSessionId: 'root', runtimeContext: child.runtimeContext! });
      expect(prepared.executionProfile?.id).toBe(id);
      expect(prepared.executionProfile?.model).toBe(id === 'sol' ? 'gpt-6.1-sol' : id === 'swe' ? 'swe-2-high' : 'swe-2-flash-medium');
    }
  });
  it('does not admit a mixed profile via ordinary creation or a forged DTO field', async () => {
    const f = await fixture();
    await expect(f.sessions.create({ ...f.dto('swe'), executionProfileId: 'swe' })).rejects.toThrow('host execution profile');
    const forged = { ...f.dto('flash'), architectureBranch: { enabled: true } };
    const ordinary = await f.sessions.create(forged);
    expect(ordinary.executionProfileId).toBe('sol');
  });
  it('still honors the durable stop topology fence at insertion', async () => {
    const f = await fixture(); const claim = sessionTreeStopAdmission(f.db).claim('root');
    try { await expect(f.create('swe')).rejects.toThrow('SESSION_TREE_STOP_IN_PROGRESS'); }
    finally { claim.release(); }
  });
});
