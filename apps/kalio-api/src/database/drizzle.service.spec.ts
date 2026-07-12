import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { DrizzleService } from './drizzle.service';

function createMigrationsFolder(journalTags: string[]): string {
  const folder = mkdtempSync(join(tmpdir(), 'kalio-migrations-'));
  mkdirSync(join(folder, 'meta'), { recursive: true });
  writeFileSync(
    join(folder, 'meta', '_journal.json'),
    JSON.stringify({ entries: journalTags.map((tag) => ({ tag })) }),
  );
  writeFileSync(
    join(folder, '0017_mcp_server_origin_source.sql'),
    "ALTER TABLE `mcp_servers` ADD COLUMN `origin_source` text NOT NULL DEFAULT 'manual';",
  );
  return folder;
}

describe('DrizzleService AgentFlow bootstrap repair', () => {
  it('creates the durable HITL table when an older migration chain stopped early', () => {
    const sqlite = new Database(':memory:');
    const service = new DrizzleService(null as never);
    (service as unknown as { sqlite: Database.Database }).sqlite = sqlite;

    (service as unknown as { ensureHitlRequestsTable: () => void }).ensureHitlRequestsTable();

    expect(sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'hitl_requests'").get())
      .toEqual({ name: 'hitl_requests' });
    expect(sqlite.prepare('PRAGMA index_list(hitl_requests)').all()).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'hitl_requests_session_status_idx' }),
      expect.objectContaining({ name: 'hitl_requests_run_status_idx' }),
    ]));
    sqlite.close();
  });

  it('backfills new agent_flow_runs columns on an existing older table', () => {
    const sqlite = new Database(':memory:');
    sqlite.exec(`
      CREATE TABLE agent_flow_runs (
        id text PRIMARY KEY NOT NULL,
        parent_session_id text NOT NULL,
        child_session_id text NOT NULL,
        flow_definition_id text NOT NULL,
        status text NOT NULL,
        start_mode text NOT NULL,
        return_mode text NOT NULL,
        result text,
        created_at integer NOT NULL,
        updated_at integer NOT NULL
      );
    `);
    const service = new DrizzleService(null as never);
    (service as unknown as { sqlite: Database.Database }).sqlite = sqlite;

    (service as unknown as { ensureAgentFlowTables: () => void }).ensureAgentFlowTables();

    const columns = sqlite.prepare('PRAGMA table_info(agent_flow_runs)').all() as Array<{ name: string }>;
    expect(columns.map((column) => column.name)).toEqual(expect.arrayContaining([
      'open_chat_session_id',
      'parent_tool_call_id',
      'open_graph_run_id',
      'waiting_for_node_id',
      'active_node_ids',
      'completed_node_ids',
      'active_phases',
      'completed_phases',
      'node_visit_counts',
      'max_iterations',
      'return_to_orchestrator_count',
      'checkpoint',
      'summary',
      'finished_at',
    ]));
    sqlite.close();
  });

  it('backfills new personas columns on an existing older table', () => {
    const sqlite = new Database(':memory:');
    sqlite.exec(`
      CREATE TABLE personas (
        id text PRIMARY KEY NOT NULL,
        name text NOT NULL,
        system_prompt text NOT NULL DEFAULT '',
        model text NOT NULL,
        allowed_tools text NOT NULL DEFAULT '[]',
        created_at integer NOT NULL,
        updated_at integer NOT NULL
      );
    `);
    const service = new DrizzleService(null as never);
    (service as unknown as { sqlite: Database.Database }).sqlite = sqlite;

    (service as unknown as { ensurePersonaColumns: () => void }).ensurePersonaColumns();

    const columns = sqlite.prepare('PRAGMA table_info(personas)').all() as Array<{ name: string }>;
    expect(columns.map((column) => column.name)).toEqual(expect.arrayContaining([
      'mcp_policy',
      'avatar_seed',
      'avatar_variant',
      'avatar_palette_key',
      'avatar_index',
      'skill_ids',
      'max_tool_attempts',
    ]));
    sqlite.close();
  });

  it('backfills new mcp_servers columns on an existing older table', () => {
    const sqlite = new Database(':memory:');
    sqlite.exec(`
      CREATE TABLE mcp_servers (
        id text PRIMARY KEY NOT NULL,
        name text NOT NULL,
        transport text NOT NULL DEFAULT 'http',
        url text,
        command text,
        args text,
        env_vars text,
        headers text,
        enabled integer NOT NULL DEFAULT 1,
        status text NOT NULL DEFAULT 'disconnected',
        tool_count integer NOT NULL DEFAULT 0,
        last_error text,
        created_at integer NOT NULL
      );
    `);
    const service = new DrizzleService(null as never);
    (service as unknown as { sqlite: Database.Database }).sqlite = sqlite;

    (service as unknown as { ensureMcpServerColumns: () => void }).ensureMcpServerColumns();

    const columns = sqlite.prepare('PRAGMA table_info(mcp_servers)').all() as Array<{ name: string }>;
    expect(columns.map((column) => column.name)).toEqual(expect.arrayContaining([
      'origin_source',
    ]));
    sqlite.close();
  });

  it('backfills the chat run revision on an existing database', () => {
    const sqlite = new Database(':memory:');
    sqlite.exec(`
      CREATE TABLE chat_runs (
        id text PRIMARY KEY NOT NULL,
        session_id text NOT NULL,
        turn_id text NOT NULL,
        status text
      );
    `);
    const service = new DrizzleService(null as never);
    (service as unknown as { sqlite: Database.Database }).sqlite = sqlite;

    (service as unknown as { ensureChatRunColumn: (name: string, definition: string) => void })
      .ensureChatRunColumn('revision', 'integer NOT NULL DEFAULT 1');

    const columns = sqlite.prepare('PRAGMA table_info(chat_runs)').all() as Array<{ name: string }>;
    expect(columns.map((column) => column.name)).toContain('revision');
    sqlite.close();
  });

  it('backfills queued chat run contract columns on an existing database', () => {
    const sqlite = new Database(':memory:');
    sqlite.exec(`
      CREATE TABLE chat_runs (
        id text PRIMARY KEY NOT NULL,
        session_id text NOT NULL,
        turn_id text NOT NULL,
        status text
      );
    `);
    const service = new DrizzleService(null as never);
    (service as unknown as { sqlite: Database.Database }).sqlite = sqlite;

    (service as unknown as { ensureChatRunColumn: (name: string, definition: string) => void })
      .ensureChatRunColumn('outcome', 'text');
    (service as unknown as { ensureChatRunColumn: (name: string, definition: string) => void })
      .ensureChatRunColumn('queue_idempotency_key', 'text');
    (service as unknown as { ensureChatRunColumn: (name: string, definition: string) => void })
      .ensureChatRunColumn('queued_payload', 'text');
    (service as unknown as { ensureChatRunColumn: (name: string, definition: string) => void })
      .ensureChatRunColumn('queued_at', 'integer');
    (service as unknown as { ensureChatRunColumn: (name: string, definition: string) => void })
      .ensureChatRunColumn('queue_claimed_at', 'integer');
    (service as unknown as { ensureChatRunColumn: (name: string, definition: string) => void })
      .ensureChatRunColumn('queue_cancelled_at', 'integer');
    (service as unknown as { ensureChatRunIndexes: () => void }).ensureChatRunIndexes();

    const columns = sqlite.prepare('PRAGMA table_info(chat_runs)').all() as Array<{ name: string }>;
    expect(columns.map((column) => column.name)).toEqual(expect.arrayContaining([
      'outcome',
      'queue_idempotency_key',
      'queued_payload',
      'queued_at',
      'queue_claimed_at',
      'queue_cancelled_at',
    ]));

    const indexes = sqlite.prepare('PRAGMA index_list(chat_runs)').all() as Array<{ name: string }>;
    expect(indexes.map((index) => index.name)).toEqual(expect.arrayContaining([
      'chat_runs_session_status_queued_at_idx',
      'chat_runs_session_queue_idempotency_key_idx',
    ]));
    sqlite.close();
  });

  it('does not warn when origin_source column and migration journal agree', () => {
    const sqlite = new Database(':memory:');
    const migrationsFolder = createMigrationsFolder(['0017_mcp_server_origin_source']);
    sqlite.exec(`
      CREATE TABLE mcp_servers (
        id text PRIMARY KEY NOT NULL,
        origin_source text NOT NULL DEFAULT 'manual'
      );
    `);
    const service = new DrizzleService(null as never);
    (service as unknown as { sqlite: Database.Database }).sqlite = sqlite;

    expect((service as unknown as { describeMigrationDrift: (folder: string) => string | null }).describeMigrationDrift(migrationsFolder)).toBeNull();

    sqlite.close();
    rmSync(migrationsFolder, { recursive: true, force: true });
  });

  it('warns when origin_source column exists but its migration is missing from the journal', () => {
    const sqlite = new Database(':memory:');
    const migrationsFolder = createMigrationsFolder([]);
    sqlite.exec(`
      CREATE TABLE mcp_servers (
        id text PRIMARY KEY NOT NULL,
        origin_source text NOT NULL DEFAULT 'manual'
      );
    `);
    const service = new DrizzleService(null as never);
    (service as unknown as { sqlite: Database.Database }).sqlite = sqlite;

    expect((service as unknown as { describeMigrationDrift: (folder: string) => string | null }).describeMigrationDrift(migrationsFolder)).toContain(
      'mcp_servers.origin_source exists before migration 0017_mcp_server_origin_source is recorded',
    );

    sqlite.close();
    rmSync(migrationsFolder, { recursive: true, force: true });
  });

  it('warns when migration journal records origin_source but the column is missing', () => {
    const sqlite = new Database(':memory:');
    const migrationsFolder = createMigrationsFolder(['0017_mcp_server_origin_source']);
    sqlite.exec(`
      CREATE TABLE mcp_servers (
        id text PRIMARY KEY NOT NULL
      );
    `);
    const service = new DrizzleService(null as never);
    (service as unknown as { sqlite: Database.Database }).sqlite = sqlite;

    expect((service as unknown as { describeMigrationDrift: (folder: string) => string | null }).describeMigrationDrift(migrationsFolder)).toContain(
      'migration 0017_mcp_server_origin_source is recorded but mcp_servers.origin_source is missing',
    );

    sqlite.close();
    rmSync(migrationsFolder, { recursive: true, force: true });
  });
});
