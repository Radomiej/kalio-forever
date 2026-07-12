import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { drizzle, BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import Database from 'better-sqlite3';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import * as schema from './schema';

@Injectable()
export class DrizzleService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DrizzleService.name);
  private sqlite!: Database.Database;
  public db!: BetterSQLite3Database<typeof schema>;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const dbPath = this.config.get<string>('DATABASE_PATH', './data/kalio.db');
    mkdirSync(dirname(dbPath), { recursive: true });
    this.sqlite = new Database(dbPath);
    this.sqlite.pragma('journal_mode = WAL');
    this.sqlite.pragma('foreign_keys = ON');
    this.db = drizzle(this.sqlite, { schema });

    // Run migrations from the migrations folder (idempotent)
    const migrationsFolder = resolve(__dirname, 'migrations');
    const migrationDriftMessage = this.describeMigrationDrift(migrationsFolder);
    if (migrationDriftMessage) {
      this.logger.warn(migrationDriftMessage);
    }
    try {
      migrate(this.db, { migrationsFolder });
      this.logger.log(`Migrations applied from ${migrationsFolder}`);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      if (/duplicate column name/i.test(errorMessage) && migrationDriftMessage) {
        this.logger.error(
          'Drizzle migration mismatch detected. Migration history likely still includes 0017_mcp_server_origin_source while mcp_servers already has origin_source from 0000_init.sql. '
          + 'To avoid non-deterministic startup state, reset local DB and re-run with a fresh migrations baseline.',
        );
        this.logger.error(`Migration warning (non-fatal): ${errorMessage}`);
      } else {
        this.logger.warn(`Migration warning (non-fatal): ${errorMessage}`);
      }
    }
    this.ensureHitlRequestsTable();
    this.ensureAgentFlowTables();
    this.ensurePersonaColumns();
    this.ensureMcpServerColumns();
    this.ensureSessionColumn('runtime_context', 'text');
    this.ensureMessageColumn('turn_id', 'text');
    this.ensureMessageColumn('prompt_message_id', 'text');
    this.ensureChatRunColumn('revision', 'integer NOT NULL DEFAULT 1');
    this.ensureChatRunColumn('outcome', 'text');
    this.ensureChatRunColumn('queue_idempotency_key', 'text');
    this.ensureChatRunColumn('queued_payload', 'text');
    this.ensureChatRunColumn('queued_at', 'integer');
    this.ensureChatRunColumn('queue_claimed_at', 'integer');
    this.ensureChatRunColumn('queue_cancelled_at', 'integer');
    this.ensureChatRunIndexes();

    this.logger.log(`Database connected: ${dbPath}`);
  }

  onModuleDestroy(): void {
    this.sqlite?.close();
    this.logger.log('Database connection closed');
  }

  private ensureHitlRequestsTable(): void {
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS hitl_requests (
        id text PRIMARY KEY NOT NULL,
        kind text NOT NULL,
        status text NOT NULL DEFAULT 'pending',
        session_id text NOT NULL,
        turn_id text,
        run_id text,
        tool_call_id text,
        payload text NOT NULL,
        continuation text,
        outcome text,
        revision integer NOT NULL DEFAULT 1,
        created_at integer NOT NULL,
        updated_at integer NOT NULL,
        resolved_at integer
      );
      CREATE INDEX IF NOT EXISTS hitl_requests_session_status_idx
        ON hitl_requests (session_id, status);
      CREATE INDEX IF NOT EXISTS hitl_requests_run_status_idx
        ON hitl_requests (run_id, status);
    `);
  }

  private ensureAgentFlowTables(): void {
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS agent_flow_runs (
        id text PRIMARY KEY NOT NULL,
        parent_session_id text NOT NULL,
        parent_tool_call_id text,
        child_session_id text NOT NULL,
        open_chat_session_id text,
        open_graph_run_id text,
        flow_definition_id text NOT NULL,
        status text NOT NULL,
        start_mode text NOT NULL,
        return_mode text NOT NULL,
        waiting_for_node_id text,
        active_node_ids text,
        completed_node_ids text,
        active_phases text,
        completed_phases text,
        node_visit_counts text,
        max_iterations integer,
        return_to_orchestrator_count integer,
        checkpoint text,
        result text,
        summary text,
        created_at integer NOT NULL,
        updated_at integer NOT NULL,
        finished_at integer
      );

      CREATE TABLE IF NOT EXISTS agent_flow_events (
        id text PRIMARY KEY NOT NULL,
        run_id text NOT NULL,
        sequence integer NOT NULL,
        type text NOT NULL,
        status text,
        message text NOT NULL,
        event text NOT NULL,
        created_at integer NOT NULL,
        FOREIGN KEY (run_id) REFERENCES agent_flow_runs(id) ON DELETE cascade
      );

      CREATE INDEX IF NOT EXISTS agent_flow_runs_parent_updated_at_idx ON agent_flow_runs (parent_session_id, updated_at);
      CREATE INDEX IF NOT EXISTS agent_flow_runs_status_updated_at_idx ON agent_flow_runs (status, updated_at);
      CREATE INDEX IF NOT EXISTS agent_flow_events_run_sequence_idx ON agent_flow_events (run_id, sequence);
      CREATE INDEX IF NOT EXISTS agent_flow_events_run_created_at_idx ON agent_flow_events (run_id, created_at);
    `);
    this.ensureAgentFlowRunColumn('open_chat_session_id', 'text');
    this.ensureAgentFlowRunColumn('parent_tool_call_id', 'text');
    this.ensureAgentFlowRunColumn('open_graph_run_id', 'text');
    this.ensureAgentFlowRunColumn('waiting_for_node_id', 'text');
    this.ensureAgentFlowRunColumn('active_node_ids', 'text');
    this.ensureAgentFlowRunColumn('completed_node_ids', 'text');
    this.ensureAgentFlowRunColumn('active_phases', 'text');
    this.ensureAgentFlowRunColumn('completed_phases', 'text');
    this.ensureAgentFlowRunColumn('node_visit_counts', 'text');
    this.ensureAgentFlowRunColumn('max_iterations', 'integer');
    this.ensureAgentFlowRunColumn('return_to_orchestrator_count', 'integer');
    this.ensureAgentFlowRunColumn('checkpoint', 'text');
    this.ensureAgentFlowRunColumn('result', 'text');
    this.ensureAgentFlowRunColumn('summary', 'text');
    this.ensureAgentFlowRunColumn('finished_at', 'integer');
    this.ensureAgentFlowRunColumn('revision', 'integer NOT NULL DEFAULT 1');
    this.ensureAgentFlowRunColumn('lease_owner', 'text');
    this.ensureAgentFlowRunColumn('lease_expires_at', 'integer');
  }

  private ensureAgentFlowRunColumn(name: string, definition: string): void {
    const columns = this.sqlite.prepare('PRAGMA table_info(agent_flow_runs)').all() as Array<{ name: string }>;
    if (columns.some((column) => column.name === name)) return;
    this.sqlite.exec(`ALTER TABLE agent_flow_runs ADD COLUMN ${name} ${definition}`);
  }

  private ensurePersonaColumns(): void {
    this.ensurePersonaColumn('mcp_policy', `text NOT NULL DEFAULT 'allow_all'`);
    this.ensurePersonaColumn('avatar_seed', 'text');
    this.ensurePersonaColumn('avatar_variant', 'text');
    this.ensurePersonaColumn('avatar_palette_key', 'text');
    this.ensurePersonaColumn('avatar_index', 'integer DEFAULT 0');
    this.ensurePersonaColumn('skill_ids', `text NOT NULL DEFAULT '[]'`);
    this.ensurePersonaColumn('max_tool_attempts', 'integer');
  }

  private ensurePersonaColumn(name: string, definition: string): void {
    const columns = this.sqlite.prepare('PRAGMA table_info(personas)').all() as Array<{ name: string }>;
    if (columns.some((column) => column.name === name)) return;
    this.sqlite.exec(`ALTER TABLE personas ADD COLUMN ${name} ${definition}`);
  }

  private ensureMcpServerColumns(): void {
    this.ensureMcpServerColumn('origin_source', `text NOT NULL DEFAULT 'manual'`);
  }

  private ensureMcpServerColumn(name: string, definition: string): void {
    const columns = this.sqlite.prepare('PRAGMA table_info(mcp_servers)').all() as Array<{ name: string }>;
    if (columns.some((column) => column.name === name)) return;
    this.sqlite.exec(`ALTER TABLE mcp_servers ADD COLUMN ${name} ${definition}`);
  }

  private describeMigrationDrift(migrationsFolder: string): string | null {
    if (!this.tableExists('mcp_servers')) {
      return null;
    }

    const mcpColumns = this.sqlite.prepare('PRAGMA table_info(mcp_servers)').all() as Array<{ name: string }>;
    const hasMcpOriginSource = mcpColumns.some((column) => column.name === 'origin_source');
    const journalHasOriginSourceMigration = this.migrationJournalContainsTag(migrationsFolder, '0017_mcp_server_origin_source');

    if (!this.migrationSqlContainsColumn(migrationsFolder, '0017_mcp_server_origin_source', 'origin_source')) {
      return null;
    }

    if (hasMcpOriginSource && journalHasOriginSourceMigration) {
      return null;
    }

    if (hasMcpOriginSource && !journalHasOriginSourceMigration) {
      return 'Detected migration drift: mcp_servers.origin_source exists before migration 0017_mcp_server_origin_source is recorded. '
        + 'This can make Drizzle try to add a duplicate column; reset the local DB or repair the migration journal.';
    }

    if (!hasMcpOriginSource && journalHasOriginSourceMigration) {
      return 'Detected migration drift: migration 0017_mcp_server_origin_source is recorded but mcp_servers.origin_source is missing. '
        + 'The startup repair will backfill the column, but the schema history should be inspected.';
    }

    return null;
  }

  private migrationSqlContainsColumn(migrationsFolder: string, tag: string, columnName: string): boolean {
    const migrationPath = resolve(migrationsFolder, `${tag}.sql`);
    if (!existsSync(migrationPath)) {
      return false;
    }

    const sql = readFileSync(migrationPath, 'utf8');
    const regex = new RegExp(`\`${columnName}\``, 'i');
    return regex.test(sql);
  }

  private migrationJournalContainsTag(migrationsFolder: string, tag: string): boolean {
    const journalPath = resolve(migrationsFolder, 'meta/_journal.json');
    if (!existsSync(journalPath)) {
      return false;
    }

    try {
      const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries?: Array<{ tag?: string }> };
      return (journal.entries ?? []).some((entry) => entry.tag === tag);
    } catch {
      return false;
    }
  }

  private tableExists(tableName: string): boolean {
    const row = this.sqlite.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name = ?",
    ).get(tableName);
    return Boolean(row);
  }

  private ensureSessionColumn(name: string, definition: string): void {
    const columns = this.sqlite.prepare('PRAGMA table_info(sessions)').all() as Array<{ name: string }>;
    if (columns.some((column) => column.name === name)) return;
    this.sqlite.exec(`ALTER TABLE sessions ADD COLUMN ${name} ${definition}`);
  }

  private ensureChatRunColumn(name: string, definition: string): void {
    const columns = this.sqlite.prepare('PRAGMA table_info(chat_runs)').all() as Array<{ name: string }>;
    if (columns.some((column) => column.name === name)) return;
    this.sqlite.exec(`ALTER TABLE chat_runs ADD COLUMN ${name} ${definition}`);
  }

  private ensureChatRunIndexes(): void {
    const columns = new Set(
      (this.sqlite.prepare('PRAGMA table_info(chat_runs)').all() as Array<{ name: string }>)
        .map((column) => column.name),
    );

    if (columns.has('session_id') && columns.has('status') && columns.has('queued_at')) {
      this.sqlite.exec(
        'CREATE INDEX IF NOT EXISTS chat_runs_session_status_queued_at_idx ON chat_runs (session_id, status, queued_at)',
      );
    }

    if (columns.has('session_id') && columns.has('queue_idempotency_key')) {
      this.sqlite.exec(
        'CREATE UNIQUE INDEX IF NOT EXISTS chat_runs_session_queue_idempotency_key_idx ON chat_runs (session_id, queue_idempotency_key)',
      );
    }
  }

  private ensureMessageColumn(name: string, definition: string): void {
    const columns = this.sqlite.prepare('PRAGMA table_info(messages)').all() as Array<{ name: string }>;
    if (columns.some((column) => column.name === name)) return;
    this.sqlite.exec(`ALTER TABLE messages ADD COLUMN ${name} ${definition}`);
  }
}
