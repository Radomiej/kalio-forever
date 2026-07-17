import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { drizzle, BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import * as schema from './schema';

const REQUIRED_MIGRATED_COLUMNS = [
  ['agent_flow_runs', [
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
    'result',
    'summary',
    'revision',
    'lease_owner',
    'lease_expires_at',
    'finished_at',
  ]],
  ['chat_runs', [
    'revision',
    'outcome',
    'queue_idempotency_key',
    'queued_payload',
    'queued_at',
    'queue_claimed_at',
    'queue_cancelled_at',
  ]],
  ['hitl_requests', [
    'id',
    'continuation',
    'outcome',
    'revision',
  ]],
  ['personas', [
    'mcp_policy',
    'avatar_seed',
    'avatar_variant',
    'avatar_palette_key',
    'avatar_index',
    'skill_ids',
    'max_tool_attempts',
  ]],
  ['mcp_servers', ['origin_source']],
  ['sessions', ['runtime_context']],
  ['messages', ['turn_id', 'prompt_message_id']],
] as const;

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

    const migrationsFolder = resolve(__dirname, 'migrations');
    try {
      migrate(this.db, { migrationsFolder });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Database migration failed for ${dbPath}: ${message}`);
      throw new Error(`Database migration failed: ${message}`, { cause: error });
    }

    this.assertMigratedSchema();
    this.logger.log(`Migrations applied from ${migrationsFolder}`);
    this.logger.log(`Database connected: ${dbPath}`);
  }

  onModuleDestroy(): void {
    this.sqlite?.close();
    this.logger.log('Database connection closed');
  }

  private assertMigratedSchema(): void {
    const missingColumns: string[] = [];

    for (const [table, expectedColumns] of REQUIRED_MIGRATED_COLUMNS) {
      const columns = this.sqlite.prepare(`PRAGMA table_info('${table}')`).all() as Array<{ name: string }>;
      const actualColumns = new Set(columns.map((column) => column.name));

      for (const column of expectedColumns) {
        if (!actualColumns.has(column)) {
          missingColumns.push(`${table}.${column}`);
        }
      }
    }

    if (missingColumns.length > 0) {
      throw new Error(
        `Database schema validation failed. Missing migrated columns: ${missingColumns.join(', ')}. `
        + 'Back up and reset the database with the explicit db:reset command.',
      );
    }
  }
}
