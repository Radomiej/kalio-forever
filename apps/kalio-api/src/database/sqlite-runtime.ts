import { createRequire } from 'node:module';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';
import type * as schemaModule from './schema';

const runtimeRequire = createRequire(__filename);

export type SqliteDriver = 'node' | 'bun';
export interface SqliteMutationResult {
  readonly changes: number;
}

export interface SqliteStatement<TRow = unknown> {
  all(...params: unknown[]): TRow[];
  get(...params: unknown[]): TRow | undefined;
  run(...params: unknown[]): SqliteMutationResult;
}

export interface SqliteClient {
  exec(sql: string): void;
  prepare<TRow = unknown>(sql: string): SqliteStatement<TRow>;
  transaction<TResult>(callback: () => TResult): () => TResult;
  loadExtension(path: string): void;
  close(): void;
}

export type KalioDrizzleDatabase = BaseSQLiteDatabase<
  'sync',
  SqliteMutationResult,
  typeof schemaModule
>;

type SqliteConstructor = new (filename: string) => SqliteClient;

type DrizzleFactory = (config: { client: unknown; schema: typeof schemaModule }) => unknown;
type MigrationRunner = (database: unknown, config: { migrationsFolder: string }) => void;
type SqliteVecLoader = (database: { loadExtension(path: string): void }) => void;

let selectedDriver: SqliteDriver | undefined;

function readNamedExport(moduleValue: unknown, name: string): unknown {
  if (typeof moduleValue !== 'object' || moduleValue === null) {
    throw new Error('SQLite runtime module does not expose ' + name + '.');
  }
  return (moduleValue as Record<string, unknown>)[name];
}

function readConstructor(value: unknown, label: string): SqliteConstructor {
  if (typeof value !== 'function') {
    throw new Error(label + ' does not expose a database constructor.');
  }
  return value as SqliteConstructor;
}

function isBunProcess(): boolean {
  return typeof process.versions.bun === 'string' && process.versions.bun.length > 0;
}

export function resolveSqliteDriver(requested = process.env.KALIO_SQLITE_DRIVER): SqliteDriver {
  const normalized = (requested ?? 'auto').trim().toLowerCase();
  if (normalized !== 'auto' && normalized !== 'node' && normalized !== 'bun') {
    throw new Error(`Unsupported KALIO_SQLITE_DRIVER: ${requested}`);
  }
  if (normalized === 'bun' && !isBunProcess()) {
    throw new Error('KALIO_SQLITE_DRIVER=bun requires the Bun runtime.');
  }
  if (normalized === 'node' && isBunProcess()) {
    throw new Error('KALIO_SQLITE_DRIVER=node is not supported under Bun; use auto or bun.');
  }
  const resolved = normalized === 'auto' ? (isBunProcess() ? 'bun' : 'node') : normalized;
  if (selectedDriver && selectedDriver !== resolved) {
    throw new Error('SQLite driver is already selected as ' + selectedDriver + '; cannot switch to ' + resolved + '.');
  }
  selectedDriver ??= resolved;
  return selectedDriver;
}

export function createSqliteDatabase(
  dbPath: string,
  requested?: string,
): { client: SqliteClient; driver: SqliteDriver } {
  const driver = resolveSqliteDriver(requested);
  if (driver === 'bun') {
    const bunDatabase = readNamedExport(runtimeRequire('bun:sqlite'), 'Database');
    const BunDatabase = readConstructor(bunDatabase, 'bun:sqlite.Database');
    return {
      client: new BunDatabase(dbPath),
      driver,
    };
  }

  const NodeDatabase = readConstructor(runtimeRequire('better-sqlite3'), 'better-sqlite3');
  return { client: new NodeDatabase(dbPath), driver };
}

export function createDrizzleDatabase(
  client: SqliteClient,
  driver: SqliteDriver,
  schema: typeof schemaModule,
): KalioDrizzleDatabase {
  const moduleName = driver === 'bun' ? 'drizzle-orm/bun-sqlite' : 'drizzle-orm/better-sqlite3';
  const drizzleExport = readNamedExport(runtimeRequire(moduleName), 'drizzle');
  if (typeof drizzleExport !== 'function') {
    throw new Error(moduleName + ' does not expose a drizzle factory.');
  }
  return (drizzleExport as DrizzleFactory)({ client, schema }) as KalioDrizzleDatabase;
}

export function migrateDrizzleDatabase(
  database: KalioDrizzleDatabase,
  driver: SqliteDriver,
  migrationsFolder: string,
): void {
  const moduleName = driver === 'bun'
    ? 'drizzle-orm/bun-sqlite/migrator'
    : 'drizzle-orm/better-sqlite3/migrator';
  const migrateExport = readNamedExport(runtimeRequire(moduleName), 'migrate');
  if (typeof migrateExport !== 'function') {
    throw new Error(moduleName + ' does not expose a migrate function.');
  }
  (migrateExport as MigrationRunner)(database, { migrationsFolder });
}

export function loadSqliteVec(client: SqliteClient): void {
  const loadExport = readNamedExport(runtimeRequire('sqlite-vec'), 'load');
  if (typeof loadExport !== 'function') {
    throw new Error('sqlite-vec does not expose a load function.');
  }
  (loadExport as SqliteVecLoader)(client);
}
