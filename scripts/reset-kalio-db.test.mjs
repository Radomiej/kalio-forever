import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { parseArguments, resetDatabase } from './reset-kalio-db.mjs';

function createFixture() {
  const root = mkdtempSync(join(tmpdir(), 'kalio-reset-'));
  const databasePath = join(root, 'data', 'kalio.db');
  mkdirSync(join(root, 'data'));
  writeFileSync(databasePath, 'database');
  writeFileSync(`${databasePath}-wal`, 'wal');
  writeFileSync(`${databasePath}-shm`, 'shm');
  return { root, databasePath };
}

test('accepts the pnpm argument separator used by the documented reset command', () => {
  assert.deepEqual(
    parseArguments(['--', '--database', 'data/kalio.db', '--confirm-reset']),
    { databasePath: 'data/kalio.db', confirmed: true },
  );
});

test('requires explicit reset confirmation before touching the database', () => {
  const { root, databasePath } = createFixture();

  try {
    assert.throws(
      () => resetDatabase({ databasePath, repositoryRoot: root, confirmed: false }),
      /--confirm-reset/,
    );
    assert.equal(readFileSync(databasePath, 'utf8'), 'database');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('backs up database and SQLite sidecars before removing them', () => {
  const { root, databasePath } = createFixture();

  try {
    const result = resetDatabase({
      databasePath,
      repositoryRoot: root,
      confirmed: true,
      now: new Date('2026-07-13T12:34:56.789Z'),
    });

    assert.equal(existsSync(databasePath), false);
    assert.equal(existsSync(`${databasePath}-wal`), false);
    assert.equal(existsSync(`${databasePath}-shm`), false);
    assert.equal(readFileSync(join(result.backupDirectory, 'kalio.db'), 'utf8'), 'database');
    assert.equal(readFileSync(join(result.backupDirectory, 'kalio.db-wal'), 'utf8'), 'wal');
    assert.equal(readFileSync(join(result.backupDirectory, 'kalio.db-shm'), 'utf8'), 'shm');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('refuses a database outside the repository data directory', () => {
  const { root } = createFixture();
  const outsideDatabasePath = join(tmpdir(), 'outside-kalio.db');
  writeFileSync(outsideDatabasePath, 'outside');

  try {
    assert.throws(
      () => resetDatabase({ databasePath: outsideDatabasePath, repositoryRoot: root, confirmed: true }),
      /must be inside/,
    );
    assert.equal(readFileSync(outsideDatabasePath, 'utf8'), 'outside');
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outsideDatabasePath, { force: true });
  }
});

test('allows an explicitly managed external dev data directory', () => {
  const { root } = createFixture();
  const devDataDirectory = join(root, 'local-app-data', 'kalio-forever-dev');
  const databasePath = join(devDataDirectory, 'kalio-dev.db');
  mkdirSync(devDataDirectory, { recursive: true });
  writeFileSync(databasePath, 'dev database');

  try {
    const result = resetDatabase({
      databasePath,
      repositoryRoot: root,
      confirmed: true,
      managedDataDirectories: [devDataDirectory],
    });

    assert.equal(existsSync(databasePath), false);
    assert.equal(readFileSync(join(result.backupDirectory, 'kalio-dev.db'), 'utf8'), 'dev database');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
