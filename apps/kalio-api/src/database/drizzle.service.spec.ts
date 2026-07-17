import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DrizzleService } from './drizzle.service';

const migrationsFolder = resolve(__dirname, 'migrations');
const requiredColumns = [
  ['agent_flow_runs', 'parent_tool_call_id'],
  ['agent_flow_runs', 'revision'],
  ['agent_flow_runs', 'lease_owner'],
  ['agent_flow_runs', 'lease_expires_at'],
  ['chat_runs', 'revision'],
  ['chat_runs', 'outcome'],
  ['chat_runs', 'queue_idempotency_key'],
  ['chat_runs', 'queued_payload'],
  ['chat_runs', 'queued_at'],
  ['chat_runs', 'queue_claimed_at'],
  ['chat_runs', 'queue_cancelled_at'],
  ['hitl_requests', 'continuation'],
  ['hitl_requests', 'outcome'],
  ['hitl_requests', 'revision'],
  ['messages', 'turn_id'],
  ['messages', 'prompt_message_id'],
] as const;
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function createTemporaryDatabasePath(): string {
  const directory = mkdtempSync(join(tmpdir(), 'kalio-drizzle-'));
  temporaryDirectories.push(directory);
  return join(directory, 'kalio.db');
}

function createMigrationFixtureAt(index: number): string {
  const sourceJournalPath = join(migrationsFolder, 'meta', '_journal.json');
  const journal = JSON.parse(readFileSync(sourceJournalPath, 'utf8')) as {
    entries: Array<{ tag: string }>;
  };
  const fixture = mkdtempSync(join(tmpdir(), 'kalio-migrations-'));
  temporaryDirectories.push(fixture);
  cpSync(migrationsFolder, fixture, { recursive: true });
  writeFileSync(
    join(fixture, 'meta', '_journal.json'),
    `${JSON.stringify({ ...journal, entries: journal.entries.slice(0, index + 1) }, null, 2)}\n`,
  );
  return fixture;
}

function migrateDatabase(dbPath: string, folder: string): void {
  const sqlite = new Database(dbPath);
  try {
    migrate(drizzle(sqlite), { migrationsFolder: folder });
  } finally {
    sqlite.close();
  }
}

function expectRequiredColumns(dbPath: string): void {
  const sqlite = new Database(dbPath, { readonly: true });
  try {
    for (const [table, column] of requiredColumns) {
      const columns = sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
      expect(columns.map((entry) => entry.name)).toContain(column);
    }
  } finally {
    sqlite.close();
  }
}

describe('DrizzleService fail-fast migrations', () => {
  it('creates a fresh database with every schema column from the migration journal', () => {
    const dbPath = createTemporaryDatabasePath();

    migrateDatabase(dbPath, migrationsFolder);

    expectRequiredColumns(dbPath);
  });

  it('upgrades a legal database at migration 0016 without relying on runtime repairs', () => {
    const dbPath = createTemporaryDatabasePath();
    migrateDatabase(dbPath, createMigrationFixtureAt(16));

    const beforeUpgrade = new Database(dbPath);
    beforeUpgrade.prepare(
      "INSERT INTO mcp_servers (id, name, created_at) VALUES ('mcp-1', 'MCP before upgrade', 1)",
    ).run();
    beforeUpgrade.close();

    migrateDatabase(dbPath, migrationsFolder);
    expectRequiredColumns(dbPath);

    const afterUpgrade = new Database(dbPath, { readonly: true });
    try {
      expect(afterUpgrade.prepare('SELECT origin_source FROM mcp_servers WHERE id = ?').get('mcp-1')).toEqual({
        origin_source: 'manual',
      });
    } finally {
      afterUpgrade.close();
    }
  });

  it('prevents Nest lifecycle initialization when a real migration cannot be applied', () => {
    const dbPath = createTemporaryDatabasePath();
    migrateDatabase(dbPath, createMigrationFixtureAt(16));

    const sqlite = new Database(dbPath);
    sqlite.exec("ALTER TABLE mcp_servers ADD COLUMN origin_source text NOT NULL DEFAULT 'manual'");
    sqlite.close();

    const service = new DrizzleService({ get: () => dbPath } as never);

    try {
      expect(() => service.onModuleInit()).toThrow('Database migration failed');
    } finally {
      service.onModuleDestroy();
    }
  });

  it('rejects a journal-complete database whose migrated schema is incomplete', () => {
    const dbPath = createTemporaryDatabasePath();
    migrateDatabase(dbPath, migrationsFolder);

    const sqlite = new Database(dbPath);
    sqlite.exec('ALTER TABLE messages DROP COLUMN turn_id');
    sqlite.close();

    const service = new DrizzleService({ get: () => dbPath } as never);

    try {
      expect(() => service.onModuleInit()).toThrow('Database schema validation failed');
    } finally {
      service.onModuleDestroy();
    }
  });
});
