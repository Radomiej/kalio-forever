import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const bun = process.env.KALIO_BUN_BINARY || 'bun';
const available = spawnSync(bun, ['--version'], { windowsHide: true }).status === 0;
let temporaryDirectory: string | undefined;

afterEach(() => {
  if (temporaryDirectory) rmSync(temporaryDirectory, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  temporaryDirectory = undefined;
});

describe.skipIf(!available)('memory partition reads in a Bun process', () => {
  it('reads legacy sources without Node native SQLite or creating missing files', () => {
    const directory = mkdtempSync(join(tmpdir(), 'kalio-bun-memory-'));
    temporaryDirectory = directory;
      const databaseDirectory = join(directory, 'database');
      const memoryDirectory = join(directory, 'modules', 'memory');
      mkdirSync(databaseDirectory, { recursive: true });
      mkdirSync(memoryDirectory, { recursive: true });
      copyFileSync(resolve('src/database/sqlite-runtime.ts'), join(databaseDirectory, 'sqlite-runtime.ts'));
      copyFileSync(resolve('src/modules/memory/memory-partitions.ts'), join(memoryDirectory, 'memory-partitions.ts'));
      const source = join(directory, 'legacy.db');
      const missing = join(directory, 'missing.db');
      const script = `
        import { Database } from 'bun:sqlite';
        import { existsSync } from 'node:fs';
        import { readMemorySource } from './modules/memory/memory-partitions.ts';
        import { createSqliteDatabase } from './database/sqlite-runtime.ts';
        const writer = new Database(${JSON.stringify(source)});
        writer.exec('CREATE TABLE memories (id TEXT, content TEXT, metadata TEXT, created_at INTEGER)');
        writer.prepare('INSERT INTO memories VALUES (?, ?, ?, ?)').run('one', 'Stored project fact', '{}', 42);
        writer.close();
        const reader = createSqliteDatabase(${JSON.stringify(source)}, 'bun', { readonly: true, fileMustExist: true }).client;
        let writeRejected = false;
        try { reader.exec('DELETE FROM memories'); } catch { writeRejected = true; } finally { reader.close(); }
        if (!writeRejected) throw new Error('Source was writable');
        const rows = readMemorySource(${JSON.stringify(source)});
        if (JSON.stringify(rows) !== JSON.stringify([{id:'one',content:'Stored project fact',metadata:{},embeddingModel:'',createdAt:42}])) throw new Error('Wrong source rows');
        let rejected = false;
        try { readMemorySource(${JSON.stringify(missing)}); } catch { rejected = true; }
        if (!rejected || existsSync(${JSON.stringify(missing)})) throw new Error('Missing source was created');
        console.log('BUN_MEMORY_SOURCE_OK');
      `;
      const result = spawnSync(bun, ['--eval', script], {
        cwd: directory, env: { ...process.env, NODE_PATH: '', KALIO_SQLITE_DRIVER: 'bun' },
        encoding: 'utf8', windowsHide: true, timeout: 15_000,
      });
      expect(result.error).toBeUndefined();
      expect(result.stderr).toBe('');
      expect(result.status).toBe(0);
      expect(result.stdout.trim()).toBe('BUN_MEMORY_SOURCE_OK');
  });
});
