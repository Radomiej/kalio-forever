import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { resolve } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DecisionSettingsPort, HitlConfig } from '@kalio/types';
import * as schema from '../../database/schema';
import { DrizzleService } from '../../database/drizzle.service';
import { ToolApprovalContextService } from '../../database/tool-approval-context.service';
import { JevDecisionsClient } from '../../common/jev-decisions.client';
import { HitlJevService } from './hitl-jev.service';
import { HitlPolicyService } from './hitl-policy.service';
import type { HitlConfigService } from './hitl-config.service';
import type { HitlDecisionService } from './hitl-decision.service';
import { ToolDispatchService } from '../chat/tool-dispatch.service';
import { TurnState } from '../chat/turn-state';
import type { StreamContext } from '../chat/interfaces/stream-context.interface';

const databases: Database.Database[] = [];
afterEach(() => { vi.unstubAllGlobals(); databases.splice(0).forEach(db => db.close()); });

function fixture(change?: (db: Database.Database) => void) {
  const sqlite = new Database(':memory:'); databases.push(sqlite);
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: resolve(__dirname, '../../database/migrations') });
  sqlite.exec(`INSERT INTO personas(id,name,model,created_at,updated_at) VALUES('persona','fixture','mock',1,1);
    INSERT INTO projects(id,name,kind,path,created_at,updated_at) VALUES('project','fixture','workspace','C:/project',1,1);
    INSERT INTO sessions(id,persona_id,project_id,kind,created_at,updated_at) VALUES('host','persona','project','chat',1,1);
    INSERT INTO sessions(id,persona_id,project_id,kind,parent_session_id,created_at,updated_at) VALUES('child','persona','project','subagent','host',1,1);
    INSERT INTO messages(id,session_id,role,content,turn_id,created_at) VALUES('goal','host','user','Inspect code in this project; no export.','host-turn',1);
    INSERT INTO messages(id,session_id,role,content,turn_id,created_at) VALUES('prompt','child','user','Locate the cleanup coordinator.','turn',2);
    INSERT INTO chat_runs(id,session_id,turn_id,phase,status,started_at,updated_at,last_heartbeat_at)
      VALUES('run','child','turn','tool_running','active',1,1,1);`);
  const database = new DrizzleService(new ConfigService()); database.db = db;
  const reader = new ToolApprovalContextService(database);
  const config: HitlConfig = { mode: 'jev', confirmationAuthority: 'decision_model', autoPersonaId: null,
    unattendedFallback: 'pause', representativePersonaId: null, notificationChannel: 'none',
    externalPolicyEnabled: false, externalPolicyPersonaId: null, raAppApprovalTimeoutMs: 0,
    jevApprovalThreshold: 0.95, jevInstructions: 'Allow only bounded project reads; deny deletion and export.', rules: [] };
  const settings = { getConfig: vi.fn(async () => structuredClone(config)), revision: 1, changing: false };
  const decisions = { getConfig: vi.fn(async () => ({ provider: 'custom' })), resolve: vi.fn(async () => ({
    protocol: 'jev-decisions', endpoint: 'https://decisions.example.test', model: 'fixture-jev', apiKey: 'fixture-only',
  })) };
  const fetchMock = vi.fn(async (_url: unknown, init: RequestInit) => {
    const sent = JSON.parse(String(init.body)) as { questions: Record<string, unknown>; state: { context: { inputs: { origin: string }[] } } };
    expect(Object.keys(sent.questions)).toEqual(['goal_alignment', 'in_scope', 'destructive_effect', 'unauthorized_export', 'evidence_sufficient']);
    expect(sent.state.context.inputs.map(input => input.origin)).toEqual(['host_recorded_input', 'delegated_objective']);
    return new Response(JSON.stringify({ model: 'fixture-jev', answers: Object.fromEntries(Object.keys(sent.questions)
      .map(id => [id, { type: 'noul', noul: id === 'destructive_effect' || id === 'unauthorized_export' ? 0.01 : 0.99 }])) }), { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  const jev = new HitlJevService(decisions as unknown as DecisionSettingsPort, new JevDecisionsClient(), reader);
  const policy = new HitlPolicyService(settings as unknown as HitlConfigService, {} as HitlDecisionService, jev);
  const execute = vi.fn(async () => 'bounded result');
  const dispatcher = new ToolDispatchService([{ meta: { name: 'terminal_spawn', description: '',
    parameters: { type: 'object' }, requiresConfirmation: true }, execute }], null, policy, null);
  const ctx: StreamContext = { sessionId: 'child', runId: 'run', turnId: 'turn', promptMessageId: 'prompt',
    messageId: 'assistant', state: new TurnState(), emit: vi.fn(), abortSignal: new AbortController().signal,
    markToolRunning: async () => { change?.(sqlite); } };
  return { sqlite, execute, dispatcher, ctx, fetchMock, config };
}

describe('SQLite context through actual Jev parser, policy and dispatcher', () => {
  it('executes only after the host-bound five-axis review', async () => {
    const f = fixture();
    expect((await f.dispatcher.dispatch('call', 'terminal_spawn', { command: 'rg', args: ['cleanup'], cwd: 'C:/project' }, f.ctx)).status).toBe('success');
    expect(f.fetchMock).toHaveBeenCalledTimes(1); expect(f.execute).toHaveBeenCalledTimes(1);
  }, 3_000);
  it.each([
    "UPDATE messages SET content='Revoke earlier task' WHERE id='goal'",
    "INSERT INTO messages(id,session_id,role,content,created_at) VALUES('update','host','user','Stop',3)",
    "UPDATE projects SET path='C:/other' WHERE id='project'",
    "UPDATE sessions SET parent_session_id=NULL WHERE id='child'",
    "UPDATE chat_runs SET status='cancelled' WHERE id='run'",
    `INSERT INTO audit_log(id,session_id,type,label,data,created_at) VALUES('deny','child','external_hitl','denied',
      '{"domain":"hitl","source":"manual","eventType":"hitl_approval_cancelled","requestId":"deny","request":{"kind":"tool","sessionId":"child","name":"terminal_spawn"},"reason":"Stop"}',3)`,
  ])('does not enter the executor after persisted context changes: %s', async mutation => {
    const f = fixture(db => db.exec(mutation));
    expect((await f.dispatcher.dispatch('call', 'terminal_spawn', { command: 'rg', cwd: 'C:/project' }, f.ctx)).status).toBe('cancelled');
    expect(f.fetchMock).toHaveBeenCalledTimes(1); expect(f.execute).not.toHaveBeenCalled();
  }, 3_000);
  it('blocks hard-denied export before any remote assessment', async () => {
    const f = fixture(); f.config.rules = [{ id: 'deny-export', kind: 'tool', name: 'terminal_spawn', executable: 'curl', decision: 'deny' }];
    expect((await f.dispatcher.dispatch('call', 'terminal_spawn', { command: 'curl', args: ['https://example.invalid'] }, f.ctx)).status).toBe('cancelled');
    expect(f.fetchMock).not.toHaveBeenCalled(); expect(f.execute).not.toHaveBeenCalled();
  });
});
