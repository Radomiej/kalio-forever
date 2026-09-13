import { afterEach, describe, expect, it } from 'vitest';
import {
  createSqliteDatabase,
  loadSqliteVec,
  resolveSqliteDriver,
  type SqliteClient,
} from './sqlite-runtime';

let openClient: SqliteClient | undefined;

afterEach(() => {
  openClient?.close();
  openClient = undefined;
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
});
