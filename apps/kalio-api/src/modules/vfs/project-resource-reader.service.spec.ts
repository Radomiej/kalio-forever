import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, symlink, rm, rename } from 'node:fs/promises';
import * as filesystem from 'node:fs/promises';
import { promises as nativeFilesystem } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, parse } from 'node:path';
import { createDrizzleDatabase, createSqliteDatabase, type SqliteClient } from '../../database/sqlite-runtime';
import type { DrizzleService } from '../../database/drizzle.service';
import * as schema from '../../database/schema';
import { ProjectResourceReaderService } from './project-resource-reader.service';
import { PROJECT_RESOURCE_READER } from '@kalio/types';
import { VFSModule } from './vfs.module';
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, open: vi.fn(actual.open) };
});

describe('ProjectResourceReaderService registered project boundary', () => {
  let root: string;
  let sql: SqliteClient;
  let service: ProjectResourceReaderService;
  beforeEach(async () => {
    vi.mocked(filesystem.open).mockImplementation(nativeFilesystem.open);
    root = await mkdtemp(join(tmpdir(), 'kalio-project-reader-'));
    const database = createSqliteDatabase(':memory:', 'node');
    sql = database.client;
    sql.exec('CREATE TABLE projects (id TEXT PRIMARY KEY, path TEXT)');
    sql.prepare('INSERT INTO projects (id,path) VALUES (?,?)').run('approved', root);
    service = new ProjectResourceReaderService({ db: createDrizzleDatabase(sql, database.driver, schema) } as DrizzleService);
  });
  afterEach(async () => { vi.restoreAllMocks(); try { sql?.close(); } finally { await rm(root, { recursive: true, force: true }); } });
  it('reads registered code and binary assets as unchanged bytes', async () => {
    await mkdir(join(root, 'src'));
    await writeFile(join(root, 'src', 'app.ts'), 'export const x = 1;');
    await writeFile(join(root, 'image.png'), Buffer.from([0, 255, 17]));
    const result = await service.readProject('approved');
    expect(result).toMatchObject({ projectId: 'approved', complete: true, skipped: [] });
    expect(result.files.map(file => file.path)).toEqual(['image.png', 'src/app.ts']);
    expect(Buffer.from(result.files[0]!.content)).toEqual(Buffer.from([0, 255, 17]));
    expect(result.files[0]!.sizeBytes).toBe(3);
  });
  it('does not interpret arbitrary paths as project IDs', async () => {
    await expect(service.readProject(root)).rejects.toThrow('PROJECT_NOT_REGISTERED');
  });
  it.each(['mts', 'cts'])('includes .%s modules in the supported code snapshot', async extension => {
    const path = `module.${extension}`;
    await writeFile(join(root, path), 'export const moduleValue = 1;');
    const result = await service.readProject('approved');
    expect(result.files.map(file => file.path)).toEqual([path]);
    expect(result.skipped).toEqual([]);
  });
  it.each([null, '', 'relative/path'])('rejects an invalid persisted root %s', async path => {
    sql.prepare('UPDATE projects SET path=? WHERE id=?').run(path, 'approved');
    await expect(service.readProject('approved')).rejects.toThrow('PROJECT_ROOT_INVALID');
  });
  it('rejects filesystem roots', async () => {
    sql.prepare('UPDATE projects SET path=? WHERE id=?').run(parse(root).root, 'approved');
    await expect(service.readProject('approved')).rejects.toThrow('PROJECT_ROOT_INVALID');
  });
  it('rejects a missing or non-directory persisted root', async () => {
    sql.prepare('UPDATE projects SET path=? WHERE id=?').run(join(root, 'missing'), 'approved');
    await expect(service.readProject('approved')).rejects.toThrow();
    await writeFile(join(root, 'file.txt'), 'x');
    sql.prepare('UPDATE projects SET path=? WHERE id=?').run(join(root, 'file.txt'), 'approved');
    await expect(service.readProject('approved')).rejects.toThrow('PROJECT_ROOT_INVALID');
  });
  it('excludes generated/dependency and secret paths while reporting unsupported files', async () => {
    for (const name of ['node_modules', 'dist', '.git', 'credentials', 'private', 'keys']) {
      await mkdir(join(root, name)); await writeFile(join(root, name, 'hidden.txt'), 'SECRET');
    }
    for (const name of ['.env', '.env.local', 'credentials.json', 'id_rsa', 'private-key.pem', 'app.exe']) await writeFile(join(root, name), 'SECRET');
    await writeFile(join(root, 'safe.md'), 'safe');
    const result = await service.readProject('approved');
    expect(result.files.map(file => file.path)).toEqual(['safe.md']);
    expect(result.skipped).toHaveLength(12);
    expect(result.skipped.find(item => item.path === 'app.exe')?.reason).toBe('unsupported');
  });
  it('does not follow a junction escaping the project root', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'kalio-outside-'));
    try {
      await writeFile(join(outside, 'secret.txt'), 'outside');
      await symlink(outside, join(root, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
      const result = await service.readProject('approved');
      expect(result.files).toEqual([]);
      expect(result.skipped).toEqual([{ path: 'escape', reason: 'link' }]);
    } finally { await rm(outside, { recursive: true, force: true }); }
  });
  it('rejects a linked registered root', async () => {
    await mkdir(join(root, 'target'));
    await symlink(join(root, 'target'), join(root, 'link'), process.platform === 'win32' ? 'junction' : 'dir');
    sql.prepare('UPDATE projects SET path=? WHERE id=?').run(join(root, 'link'), 'approved');
    await expect(service.readProject('approved')).rejects.toThrow('PROJECT_ROOT_INVALID');
  });
  it('throws rather than returning a partial snapshot above the per-file limit', async () => {
    await writeFile(join(root, 'big.txt'), Buffer.alloc(1024 * 1024 + 1));
    await expect(service.readProject('approved')).rejects.toThrow('PROJECT_RESOURCE_LIMIT');
  });
  it('throws above the total byte limit', async () => {
    for (let index = 0; index < 21; index++) await writeFile(join(root, `${index}.txt`), Buffer.alloc(1024 * 1024));
    await expect(service.readProject('approved')).rejects.toThrow('PROJECT_RESOURCE_LIMIT');
  });
  it('throws above 500 files', async () => {
    for (let index = 0; index < 501; index++) await writeFile(join(root, `${index}.txt`), '');
    await expect(service.readProject('approved')).rejects.toThrow('PROJECT_RESOURCE_LIMIT');
  });
  it('throws above depth 16', async () => {
    let directory = root;
    for (let index = 0; index < 17; index++) { directory = join(directory, 'd'); await mkdir(directory); }
    await expect(service.readProject('approved')).rejects.toThrow('PROJECT_RESOURCE_LIMIT');
  });
  it('honors an already aborted request without a partial snapshot', async () => {
    const controller = new AbortController(); controller.abort();
    await expect(service.readProject('approved', controller.signal)).rejects.toThrow('aborted');
  });
  it('rejects file replacement between path validation and open, before reading its bytes', async () => {
    const path = join(root, 'safe.txt'); await writeFile(path, 'approved');
    const actualOpen = nativeFilesystem.open;
    let bytesRead = 0;
    vi.mocked(filesystem.open).mockImplementation(async (...args) => {
      if (args[0] !== path) return actualOpen(...args);
      await rename(path, join(root, 'old.txt')); await writeFile(path, 'replacement');
      const handle = await actualOpen(...args);
      const actualRead = handle.read.bind(handle);
      vi.spyOn(handle, 'read').mockImplementation(async (...readArgs) => { bytesRead++; return actualRead(...readArgs); });
      return handle;
    });
    await expect(service.readProject('approved')).rejects.toThrow('PROJECT_RESOURCE_CHANGED');
    expect(bytesRead).toBe(0);
  });
  it('honors cancellation after open and closes the descriptor without reading', async () => {
    await writeFile(join(root, 'safe.txt'), 'approved');
    const controller = new AbortController();
    const actualOpen = nativeFilesystem.open;
    const close = vi.fn();
    vi.mocked(filesystem.open).mockImplementationOnce(async (...args) => {
      const handle = await actualOpen(...args);
      const actualClose = handle.close.bind(handle);
      vi.spyOn(handle, 'close').mockImplementation(async () => { close(); await actualClose(); });
      controller.abort(); return handle;
    });
    await expect(service.readProject('approved', controller.signal)).rejects.toThrow('aborted');
    expect(close).toHaveBeenCalledOnce();
  });
  it('accepts the exact 1 MiB per-file bound', async () => {
    await writeFile(join(root, 'exact.pdf'), Buffer.alloc(1024 * 1024));
    const result = await service.readProject('approved');
    expect(result.files[0]!.content.byteLength).toBe(1024 * 1024);
    expect(result.complete).toBe(true);
  });
  it('exports the shared token with useExisting rather than constructing another reader', () => {
    expect(typeof PROJECT_RESOURCE_READER).toBe('symbol');
    expect(Reflect.getMetadata('providers', VFSModule)).toContainEqual({ provide: PROJECT_RESOURCE_READER, useExisting: ProjectResourceReaderService });
    expect(Reflect.getMetadata('exports', VFSModule)).toContain(PROJECT_RESOURCE_READER);
  });
  it('bounds enumeration of unsupported entries rather than returning unlimited skipped metadata', async () => {
    const fixtureRoot = root;
    for (let start = 0; start < 5001; start += 50) {
      await Promise.all(Array.from({ length: Math.min(50, 5001 - start) }, (_, offset) =>
        writeFile(join(fixtureRoot, `${start + offset}.unsupported`), '')));
    }
    await expect(service.readProject('approved')).rejects.toThrow('PROJECT_RESOURCE_LIMIT');
  }, 30_000);
  it('accepts an empty registered project as a completed enumeration', async () => {
    expect(await service.readProject('approved')).toEqual({ projectId: 'approved', files: [], skipped: [], complete: true });
  });
});
