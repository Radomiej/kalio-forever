import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createDrizzleDatabase, createSqliteDatabase, migrateDrizzleDatabase, type KalioDrizzleDatabase, type SqliteClient } from './sqlite-runtime';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { readMigrationFiles, type MigrationMeta } from 'drizzle-orm/migrator';
import * as schema from './schema';

const REQUIRED_MIGRATED_COLUMNS = [
  ['execution_profiles', [
    'id',
    'name',
    'kind',
    'model',
    'approval_mode',
    'enabled',
    'capabilities_version',
  ]],
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
    'runtime_kind',
    'execution_profile_id',
    'external_thread_id',
    'external_turn_id',
    'process_epoch',
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
    'execution_profile_id',
    'provider_tool_names',
  ]],
  ['projects', ['default_execution_profile_id']],
  ['mcp_servers', ['origin_source']],
  ['sessions', [
    'runtime_context',
    'execution_profile_id',
    'external_thread_id',
    'toolset_fingerprint',
    'policy_fingerprint',
    'runtime_binding_version',
  ]],
  ['messages', ['turn_id', 'prompt_message_id']],
] as const;

const PRIMARY_SCHEMA_BACKFILL_COLUMNS = [
  ['agent_flow_runs', 'parent_tool_call_id'],
  ['messages', 'turn_id'],
  ['messages', 'prompt_message_id'],
] as const;
const LEGACY_0023_TAG = '0023_chat_run_queue_contract';
const LEGACY_0024_TAG = '0024_primary-schema-backfill';
const LEGACY_0023_WHEN = 1783797000000;
// Git checkouts use LF on CI and may use CRLF on Windows; both hashes identify the same official migration.
const LEGACY_0023_HASHES = new Set([
  'ed5c6d0922267a7cb07c11f305b7443898c5ad6bddcf5e9b1686c212cbe79930',
  'b5eb0d241f13f0ed0c866f1c0fe7527f725cfe13167a8cb2647954ee97a0b59c',
]);

interface MigrationJournalEntry {
  idx: number;
  tag: string;
  when: number;
}

interface MigrationJournalFile {
  entries: MigrationJournalEntry[];
}

interface MigrationJournalRow {
  id: number;
  hash: string;
  created_at: number | string;
}

interface MigrationColumnInfo {
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | number | null;
  pk: number;
}

function readMigrationJournal(migrationsFolder: string): MigrationJournalFile {
  const parsed: unknown = JSON.parse(
    readFileSync(join(migrationsFolder, 'meta', '_journal.json'), 'utf8'),
  );
  if (!isRecord(parsed) || !Array.isArray(parsed.entries)) {
    throw new Error('Migration journal has an invalid shape.');
  }
  const entries = parsed.entries.flatMap((entry): MigrationJournalEntry[] => {
    if (!isRecord(entry)) return [];
    const idx = entry.idx;
    const tag = entry.tag;
    const when = entry.when;
    return typeof idx === 'number' && Number.isInteger(idx)
      && typeof tag === 'string'
      && typeof when === 'number' && Number.isFinite(when)
      ? [{ idx, tag, when }]
      : [];
  });
  if (entries.length !== parsed.entries.length) {
    throw new Error('Migration journal contains an invalid entry.');
  }
  return { entries };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readJournalRows(sqlite: SqliteClient): MigrationJournalRow[] {
  const table = sqlite.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations' LIMIT 1",
  ).get();
  if (!table) return [];
  return sqlite.prepare(
    'SELECT id, hash, created_at FROM "__drizzle_migrations" ORDER BY id ASC',
  ).all() as MigrationJournalRow[];
}

function migrationTimestamp(value: number | string): number {
  const timestamp = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(timestamp)) {
    throw new Error('Migration journal contains an invalid created_at value.');
  }
  return timestamp;
}

function assertOfficialBaselineJournal(
  rows: MigrationJournalRow[],
  journal: MigrationJournalFile,
  migrations: MigrationMeta[],
  baseline: MigrationJournalEntry,
): void {
  const expectedEntries = journal.entries
    .filter((entry) => entry.idx <= baseline.idx)
    .sort((left, right) => left.idx - right.idx);
  if (rows.length !== expectedEntries.length) {
    throw new Error('Migration journal is not the exact official 0023 prefix.');
  }
  expectedEntries.forEach((entry, index) => {
    const row = rows[index];
    const migration = migrations[entry.idx];
    if (!row || !migration || row.hash !== migration.hash || migrationTimestamp(row.created_at) !== entry.when) {
      throw new Error('Migration journal contains an out-of-order or mismatched 0023 prefix.');
    }
  });
}

function inspectBackfillColumns(sqlite: SqliteClient): {
  present: number;
  valid: number;
  invalid: string[];
} {
  let present = 0;
  let valid = 0;
  const invalid: string[] = [];
  for (const [table, column] of PRIMARY_SCHEMA_BACKFILL_COLUMNS) {
    const row = sqlite.prepare(`PRAGMA table_info('${table}')`).all() as MigrationColumnInfo[];
    const info = row.find((candidate) => candidate.name === column);
    if (!info) continue;
    present += 1;
    const exactNullableText = info.type.toUpperCase() === 'TEXT'
      && info.notnull === 0
      && info.dflt_value === null
      && info.pk === 0;
    if (exactNullableText) {
      valid += 1;
    } else {
      invalid.push(`${table}.${column}`);
    }
  }
  return { present, valid, invalid };
}

export function reconcileLegacyPrimarySchema(
  sqlite: SqliteClient,
  migrationsFolder: string,
): void {
  const journal = readMigrationJournal(migrationsFolder);
  const migrations = readMigrationFiles({ migrationsFolder });
  const baseline = journal.entries.find((entry) => entry.tag === LEGACY_0023_TAG);
  const compatibilityMigration = journal.entries.find((entry) => entry.tag === LEGACY_0024_TAG);
  if (!baseline || !compatibilityMigration) {
    return;
  }
  const baselineMigration = migrations[baseline.idx];
  const targetMigration = migrations[compatibilityMigration.idx];
  if (!baselineMigration || !targetMigration
    || baseline.when !== LEGACY_0023_WHEN
    || !LEGACY_0023_HASHES.has(baselineMigration.hash)
    || baselineMigration.folderMillis !== LEGACY_0023_WHEN) {
    throw new Error('Migration journal does not match the pinned official 0023 migration.');
  }

  const rows = readJournalRows(sqlite);
  if (rows.length === 0) return;
  const targetApplied = rows.some((row) =>
    row.hash === targetMigration.hash && migrationTimestamp(row.created_at) === targetMigration.folderMillis);
  if (targetApplied) return;

  const columnState = inspectBackfillColumns(sqlite);
  if (columnState.present === 0) return;
  if (columnState.invalid.length > 0 || columnState.valid !== PRIMARY_SCHEMA_BACKFILL_COLUMNS.length) {
    throw new Error(
      `Migration 0024 compatibility state is partial or invalid: ${[...columnState.invalid].join(', ') || 'missing columns'}.`,
    );
  }

  const latest = rows.at(-1);
  if (!latest
    || latest.hash !== baselineMigration.hash
    || migrationTimestamp(latest.created_at) !== baseline.when) {
    throw new Error('Pre-migration backfill columns exist without the official 0023 journal state.');
  }
  assertOfficialBaselineJournal(rows, journal, migrations, baseline);

  sqlite.exec('BEGIN IMMEDIATE');
  try {
    const currentRows = readJournalRows(sqlite);
    const currentTargetApplied = currentRows.some((row) =>
      row.hash === targetMigration.hash && migrationTimestamp(row.created_at) === targetMigration.folderMillis);
    if (!currentTargetApplied) {
      const currentLatest = currentRows.at(-1);
      if (!currentLatest
        || currentLatest.hash !== baselineMigration.hash
        || migrationTimestamp(currentLatest.created_at) !== baseline.when) {
        throw new Error('Migration journal changed while reconciling migration 0024.');
      }
      assertOfficialBaselineJournal(currentRows, journal, migrations, baseline);
      const currentState = inspectBackfillColumns(sqlite);
      if (currentState.invalid.length > 0 || currentState.valid !== PRIMARY_SCHEMA_BACKFILL_COLUMNS.length) {
        throw new Error('Migration 0024 schema state changed while reconciling.');
      }
      sqlite.prepare(
        'INSERT INTO "__drizzle_migrations" (hash, created_at) VALUES (?, ?)',
      ).run(targetMigration.hash, targetMigration.folderMillis);
    }
    sqlite.exec('COMMIT');
  } catch (error) {
    sqlite.exec('ROLLBACK');
    throw error;
  }
}

@Injectable()
export class DrizzleService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DrizzleService.name);
  private sqlite!: SqliteClient;
  public db!: KalioDrizzleDatabase;

  constructor(private readonly config: ConfigService) {}

  async onModuleInit(): Promise<void> {
    const dbPath = this.config.get<string>('DATABASE_PATH', './data/kalio.db');
    const requestedDriver = this.config.get<string>('KALIO_SQLITE_DRIVER');
    mkdirSync(dirname(dbPath), { recursive: true });
    const database = createSqliteDatabase(dbPath, requestedDriver);
    this.sqlite = database.client;
    this.sqlite.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    this.db = createDrizzleDatabase(this.sqlite, database.driver, schema);

    const migrationsFolder = resolve(__dirname, 'migrations');
    try {
      reconcileLegacyPrimarySchema(this.sqlite, migrationsFolder);
      migrateDrizzleDatabase(this.db, database.driver, migrationsFolder);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Database migration failed for ${dbPath}: ${message}`);
      throw new Error(`Database migration failed: ${message}`, { cause: error });
    }

    this.assertMigratedSchema();
    this.logger.log(`Migrations applied from ${migrationsFolder}`);
    this.logger.log(`Database connected: ${dbPath} (${database.driver})`);
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
