import { describe, expect, it, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../database/schema';
import { DrizzleService } from '../../database/drizzle.service';
import { SecurityPolicyService } from './security-policy.service';
import type { HitlConfigService } from './hitl-config.service';
import type { HitlDecisionService } from './hitl-decision.service';

function makeTestDrizzle(): DrizzleService {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS personas (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      system_prompt TEXT NOT NULL DEFAULT '',
      model TEXT NOT NULL,
      max_tool_attempts INTEGER,
      allowed_tools TEXT NOT NULL DEFAULT '[]',
      skill_ids TEXT NOT NULL DEFAULT '[]',
      mcp_policy TEXT NOT NULL DEFAULT 'allow_all',
      avatar_seed TEXT,
      avatar_variant TEXT,
      avatar_palette_key TEXT,
      avatar_index INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      persona_id TEXT NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
      title TEXT NOT NULL DEFAULT '',
      kind TEXT NOT NULL DEFAULT 'chat',
      parent_session_id TEXT,
      parent_turn_id TEXT,
      parent_tool_call_id TEXT,
      archived_at INTEGER,
      runtime_context TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      turn_id TEXT,
      prompt_message_id TEXT,
      thinking TEXT,
      tool_calls TEXT,
      tool_call_id TEXT,
      attachments TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY,
      session_id TEXT,
      type TEXT NOT NULL,
      label TEXT NOT NULL,
      data TEXT,
      duration_ms INTEGER,
      chunk_count INTEGER,
      created_at INTEGER NOT NULL
    );
  `);
  const db = drizzle(sqlite, { schema });
  const drizzleSvc = new DrizzleService(null as never);
  (drizzleSvc as unknown as { db: typeof db }).db = db;
  return drizzleSvc;
}

async function seedSession(drizzleSvc: DrizzleService, sessionId: string): Promise<void> {
  const now = new Date();
  await drizzleSvc.db.insert(schema.personas).values({
    id: 'persona-1',
    name: 'Reviewer',
    systemPrompt: '',
    model: 'mock',
    allowedTools: [],
    skillIds: [],
    createdAt: now,
    updatedAt: now,
  });
  await drizzleSvc.db.insert(schema.sessions).values({
    id: sessionId,
    personaId: 'persona-1',
    title: 'Policy Session',
    createdAt: now,
    updatedAt: now,
  });
}

describe('SecurityPolicyService', () => {
  let drizzleSvc: DrizzleService;
  let hitlConfig: { getConfig: ReturnType<typeof vi.fn> };
  let hitlDecision: { evaluateApproval: ReturnType<typeof vi.fn> };
  let service: SecurityPolicyService;

  beforeEach(() => {
    drizzleSvc = makeTestDrizzle();
    hitlConfig = {
      getConfig: vi.fn().mockResolvedValue({
        mode: 'manual',
        autoPersonaId: null,
        unattendedFallback: 'pause',
        representativePersonaId: null,
        notificationChannel: 'none',
        externalPolicyEnabled: false,
        externalPolicyPersonaId: null,
        raAppApprovalTimeoutMs: 600_000,
      }),
    };
    hitlDecision = {
      evaluateApproval: vi.fn(),
    };
    service = new SecurityPolicyService(
      hitlConfig as unknown as HitlConfigService,
      hitlDecision as unknown as HitlDecisionService,
      drizzleSvc,
    );
  });

  it('asks the user and audits the request when external policy is disabled', async () => {
    const response = await service.evaluate({
      source: 'manual',
      subject: { sessionId: 'missing-session' },
      action: { kind: 'tool', name: 'fs_write', paths: ['README.md'] },
      risk: 'high',
      context: { reason: 'host write' },
    });

    expect(response).toMatchObject({
      decision: 'ask_user',
      reason: 'External HITL policy service is disabled.',
      risk: 'high',
    });
    expect(response.auditId).toEqual(expect.any(String));
    expect(hitlDecision.evaluateApproval).not.toHaveBeenCalled();

    const auditRows = await drizzleSvc.db.select().from(schema.auditLog);
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]).toMatchObject({
      sessionId: 'missing-session',
      type: 'external_hitl',
      label: 'External HITL ask_user: fs_write',
    });
    expect(auditRows[0].data).toMatchObject({
      eventType: 'external_security_ask_user',
      requestId: response.auditId,
      request: expect.objectContaining({
        action: expect.objectContaining({ name: 'fs_write' }),
      }),
      response: expect.objectContaining({ decision: 'ask_user' }),
    });

    await expect(drizzleSvc.db.select().from(schema.messages)).resolves.toEqual([]);
  });

  it('allows and writes a conversation policy message when external decision agrees', async () => {
    await seedSession(drizzleSvc, 'session-1');
    hitlConfig.getConfig.mockResolvedValue({
      mode: 'manual',
      autoPersonaId: null,
      unattendedFallback: 'pause',
      representativePersonaId: null,
      notificationChannel: 'none',
      externalPolicyEnabled: true,
      externalPolicyPersonaId: 'policy-persona',
      raAppApprovalTimeoutMs: 600_000,
    });
    hitlDecision.evaluateApproval.mockResolvedValue({
      agree: true,
      reason: 'Path is inside the approved project.',
    });

    const response = await service.evaluate({
      request: {
        agentId: 'codex',
        sessionId: 'session-1',
        turnId: 'turn-1',
        requestedAction: 'fs_write',
        commandOrTool: 'fs_write',
        workdir: 'C:\\Projekty\\kalio-forever',
        risk: 'critical',
        reason: 'materialize approved file',
        requestedMode: 'write',
      },
      mode: 'fallback-mode',
    });

    expect(response).toMatchObject({
      decision: 'allow',
      reason: 'Path is inside the approved project.',
      risk: 'critical',
    });
    expect(hitlDecision.evaluateApproval).toHaveBeenCalledWith({
      personaId: 'policy-persona',
      request: expect.objectContaining({
        kind: 'external_security',
        sessionId: 'session-1',
        name: 'fs_write',
        displayLabel: 'mcp-cli-agents / codex / fs_write / fs_write',
        toolCallId: 'turn-1',
      }),
    });

    const messages = await drizzleSvc.db.select().from(schema.messages);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      sessionId: 'session-1',
      role: 'system',
    });
    expect(messages[0].content).toContain('Action: fs_write/fs_write');
    expect(messages[0].content).toContain('Decision: allow');

    const auditRows = await drizzleSvc.db.select().from(schema.auditLog);
    expect(auditRows[0].data).toMatchObject({
      eventType: 'external_security_allow',
      request: expect.objectContaining({
        source: 'mcp-cli-agents',
        context: expect.objectContaining({ permissionMode: 'write' }),
      }),
    });
  });

  it('falls back to ask_user and still audits when the external evaluator fails', async () => {
    hitlConfig.getConfig.mockResolvedValue({
      mode: 'manual',
      autoPersonaId: null,
      unattendedFallback: 'pause',
      representativePersonaId: null,
      notificationChannel: 'none',
      externalPolicyEnabled: true,
      externalPolicyPersonaId: 'policy-persona',
      raAppApprovalTimeoutMs: 600_000,
    });
    hitlDecision.evaluateApproval.mockRejectedValue(new Error('policy offline'));

    const response = await service.evaluate({
      action: { kind: 'terminal', commandOrTool: 'pnpm test' },
      risk: 'not-a-risk',
    });

    expect(response).toMatchObject({
      decision: 'ask_user',
      reason: 'External HITL policy failed: policy offline',
      risk: 'medium',
    });

    const auditRows = await drizzleSvc.db.select().from(schema.auditLog);
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]).toMatchObject({
      sessionId: null,
      label: 'External HITL ask_user: pnpm test',
    });
    expect(auditRows[0].data).toMatchObject({
      eventType: 'external_security_ask_user',
      response: expect.objectContaining({ reason: 'External HITL policy failed: policy offline' }),
    });
  });
});
