import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as schema from '../../database/schema';
import { DrizzleService } from '../../database/drizzle.service';
import { CLIAgentSessionService } from './cli-agent-session.service';

describe('CLIAgentSessionService metadata contract', () => {
  let sqlite: Database.Database;
  let drizzleService: DrizzleService;
  let service: CLIAgentSessionService;

  beforeEach(async () => {
    sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    sqlite.exec(`
      CREATE TABLE personas (
        id text primary key,
        name text not null,
        system_prompt text not null default '',
        model text not null,
        max_tool_attempts integer,
        allowed_tools text not null default '[]',
        skill_ids text not null default '[]',
        mcp_policy text not null default 'allow_all',
        avatar_seed text,
        avatar_variant text,
        avatar_palette_key text,
        avatar_index integer default 0,
        created_at integer not null,
        updated_at integer not null
      );
      CREATE TABLE sessions (
        id text primary key,
        persona_id text not null references personas(id) on delete cascade,
        title text not null default '',
        kind text not null default 'chat',
        parent_session_id text,
        parent_turn_id text,
        parent_tool_call_id text,
        runtime_context text,
        archived_at integer,
        created_at integer not null,
        updated_at integer not null
      );
      CREATE TABLE messages (
        id text primary key,
        session_id text not null references sessions(id) on delete cascade,
        role text not null,
        content text not null,
        turn_id text,
        prompt_message_id text,
        thinking text,
        tool_calls text,
        tool_call_id text,
        attachments text,
        created_at integer not null
      );
    `);

    drizzleService = new DrizzleService(null as never);
    (drizzleService as unknown as { db: ReturnType<typeof drizzle> }).db = drizzle(sqlite, { schema });
    service = new CLIAgentSessionService(drizzleService);

    await drizzleService.db.insert(schema.personas).values({
      id: 'default',
      name: 'Default',
      systemPrompt: '',
      model: 'mock',
      createdAt: new Date(1),
      updatedAt: new Date(1),
    });
    await drizzleService.db.insert(schema.sessions).values({
      id: 'parent',
      personaId: 'default',
      title: 'Parent',
      kind: 'chat',
      createdAt: new Date(1),
      updatedAt: new Date(1),
    });
  });

  afterEach(() => {
    sqlite.close();
  });

  it('stores CLI metadata in typed session runtimeContext instead of system message content', async () => {
    const child = await service.createChildSession({
      parentSessionId: 'parent',
      parentToolCallId: 'call-cli',
      agentId: 'codex',
      title: 'Codex CLI',
    });

    await service.saveSessionMetadata(child.id, {
      agentId: 'codex',
      workdir: 'C:/repo',
    });

    const loaded = await service.loadSessionMetadata(child.id);
    const [sessionRow] = await drizzleService.db
      .select({ runtimeContext: schema.sessions.runtimeContext })
      .from(schema.sessions)
      .where(eq(schema.sessions.id, child.id))
      .limit(1);
    const systemMessages = await drizzleService.db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.role, 'system'));

    expect(loaded).toEqual({ agentId: 'codex', workdir: 'C:/repo' });
    expect(sessionRow.runtimeContext).toMatchObject({
      runtimeKind: 'cli-agent',
      parentSessionId: 'parent',
      parentToolCallId: 'call-cli',
      toolPolicyProfile: 'cli-agent',
      cliAgentContext: { agentId: 'codex', workdir: 'C:/repo' },
    });
    expect(systemMessages).toEqual([]);
  });

  it('does not load legacy prefixed metadata from system message content on the runtime read path', async () => {
    await drizzleService.db.insert(schema.sessions).values({
      id: 'legacy-child',
      personaId: 'default',
      title: 'Legacy CLI',
      kind: 'cli-agent',
      parentSessionId: 'parent',
      parentToolCallId: 'call-cli',
      createdAt: new Date(1),
      updatedAt: new Date(1),
    });
    await drizzleService.db.insert(schema.messages).values({
      id: 'legacy-meta',
      sessionId: 'legacy-child',
      role: 'system',
      content: '__kalio_cli_agent_meta__:{"agentId":"codex","workdir":"C:/repo"}',
      createdAt: new Date(2),
    });

    await expect(service.loadSessionMetadata('legacy-child')).resolves.toBeNull();
  });

  it('migrates legacy prefixed metadata into typed runtimeContext before runtime reads it', async () => {
    await drizzleService.db.insert(schema.sessions).values({
      id: 'legacy-child',
      personaId: 'default',
      title: 'Legacy CLI',
      kind: 'cli-agent',
      parentSessionId: 'parent',
      parentToolCallId: 'call-cli',
      createdAt: new Date(1),
      updatedAt: new Date(1),
    });
    await drizzleService.db.insert(schema.messages).values({
      id: 'legacy-meta',
      sessionId: 'legacy-child',
      role: 'system',
      content: '__kalio_cli_agent_meta__:{"agentId":"codex","workdir":"C:/repo"}',
      createdAt: new Date(2),
    });

    await expect(service.migrateLegacySessionMetadata('legacy-child')).resolves.toEqual({
      agentId: 'codex',
      workdir: 'C:/repo',
    });
    await expect(service.loadSessionMetadata('legacy-child')).resolves.toEqual({
      agentId: 'codex',
      workdir: 'C:/repo',
    });

    const [sessionRow] = await drizzleService.db
      .select({ runtimeContext: schema.sessions.runtimeContext })
      .from(schema.sessions)
      .where(eq(schema.sessions.id, 'legacy-child'))
      .limit(1);

    expect(sessionRow.runtimeContext).toMatchObject({
      runtimeKind: 'cli-agent',
      parentSessionId: 'parent',
      parentToolCallId: 'call-cli',
      toolPolicyProfile: 'cli-agent',
      cliAgentContext: { agentId: 'codex', workdir: 'C:/repo' },
    });
  });
});
