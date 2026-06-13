import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { drizzle, BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
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
    try {
      migrate(this.db, { migrationsFolder });
      this.logger.log(`Migrations applied from ${migrationsFolder}`);
    } catch (err) {
      this.logger.warn(`Migration warning (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
    }
    this.ensureAgentFlowTables();
    this.ensurePersonaColumns();
    this.ensureSessionColumn('runtime_context', 'text');

    this.logger.log(`Database connected: ${dbPath}`);
  }

  onModuleDestroy(): void {
    this.sqlite?.close();
    this.logger.log('Database connection closed');
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

  private ensureSessionColumn(name: string, definition: string): void {
    const columns = this.sqlite.prepare('PRAGMA table_info(sessions)').all() as Array<{ name: string }>;
    if (columns.some((column) => column.name === name)) return;
    this.sqlite.exec(`ALTER TABLE sessions ADD COLUMN ${name} ${definition}`);
  }
}
