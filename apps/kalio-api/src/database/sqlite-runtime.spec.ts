import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createSqliteDatabase,
  loadSqliteVec,
  resolveSqliteDriver,
  type SqliteClient,
} from './sqlite-runtime';

let openClient: SqliteClient | undefined;
let temporaryDirectory: string | undefined;

afterEach(() => {
  openClient?.close();
  openClient = undefined;
  if (temporaryDirectory) rmSync(temporaryDirectory, { recursive: true, force: true });
  temporaryDirectory = undefined;
});

describe('sqlite runtime selection', () => {
  it('selects the Node driver in the Node runtime', () => {
    expect(resolveSqliteDriver('auto')).toBe('node');
    expect(resolveSqliteDriver('node')).toBe('node');
  });

  it('rejects Bun-only selection when running under Node', () => {
    expect(() => resolveSqliteDriver('bun')).toThrow(
      'KALIO_SQLITE_DRIVER=bun requires the Bun runtime.',
    );
  });

  it('opens SQLite and loads sqlite-vec through the selected driver', () => {
    const database = createSqliteDatabase(':memory:', 'node');
    openClient = database.client;

    expect(database.driver).toBe('node');
    loadSqliteVec(database.client);

    const row = database.client
      .prepare('SELECT vec_version() AS version')
      .get() as { version: string };
    expect(row.version).toMatch(/^v\d+\.\d+\.\d+$/);
  });

  it('keeps existing databases read-only and refuses to create missing source files', () => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), 'kalio-sqlite-readonly-'));
    const source = join(temporaryDirectory, 'source.db');
    const writer = createSqliteDatabase(source, 'node').client;
    writer.exec('CREATE TABLE example (value TEXT)');
    writer.close();
    openClient = createSqliteDatabase(source, 'node', { readonly: true, fileMustExist: true }).client;
    expect(() => openClient!.exec("INSERT INTO example VALUES ('changed')")).toThrow(/readonly/i);
    const missing = join(temporaryDirectory, 'missing.db');
    expect(() => createSqliteDatabase(missing, 'node', { readonly: true, fileMustExist: true })).toThrow();
    expect(existsSync(missing)).toBe(false);
  });
});
