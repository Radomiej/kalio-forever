import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { PROJECT_CONTEXT_PORT, PROJECT_RESOURCE_READER, PROJECT_RESOURCE_INDEX_STORAGE, type ProjectContextPort } from '@kalio/types';
import { createDrizzleDatabase, createSqliteDatabase } from '../../database/sqlite-runtime';
import { DrizzleService } from '../../database/drizzle.service';
import * as schema from '../../database/schema';
import { ProjectResourceReaderService } from '../vfs/project-resource-reader.service';
import { VFSModule } from '../vfs/vfs.module';
import { MemoryModule } from './memory.module';
import { EmbeddingService } from './embedding.service';
import { ProjectResourceIndexService } from './project-resource-index.service';
import { ProjectContextSettingsService } from './project-context-settings.service';

describe('registered HomeSite shared project context port', () => {
  const homeSitePath = process.env.KALIO_PROJECT_CONTEXT_HOMESITE_PATH;
  it.skipIf(!homeSitePath)('compiles injection and resolves the persisted session through the real VFS reader', async () => {
    const database = createSqliteDatabase(':memory:', 'node');
    const sql = database.client;
    sql.exec('CREATE TABLE projects (id TEXT PRIMARY KEY, path TEXT); CREATE TABLE sessions (id TEXT PRIMARY KEY, project_id TEXT)');
    sql.prepare('INSERT INTO projects (id,path) VALUES (?,?)').run('homesite-registered', homeSitePath!);
    sql.prepare('INSERT INTO sessions (id,project_id) VALUES (?,?)').run('homesite-session', 'homesite-registered');
    const drizzle = { db: createDrizzleDatabase(sql, database.driver, schema) } as DrizzleService;
    const module = await Test.createTestingModule({ providers: [ProjectResourceIndexService, ProjectResourceReaderService,
      { provide: PROJECT_CONTEXT_PORT, useExisting: ProjectResourceIndexService },
      { provide: PROJECT_RESOURCE_READER, useExisting: ProjectResourceReaderService },
      // This boundary test replaces indexing below; storage allocation must not be reached.
      { provide: PROJECT_RESOURCE_INDEX_STORAGE, useValue: { exists: () => false,
        prepare: () => { throw new Error('UNEXPECTED_INDEX_ALLOCATION'); } } },
      { provide: DrizzleService, useValue: drizzle },
      { provide: EmbeddingService, useValue: {} }, { provide: ProjectContextSettingsService, useValue: {} },
    ] }).compile();
    try {
      const port = module.get<ProjectContextPort>(PROJECT_CONTEXT_PORT);
      const service = module.get(ProjectResourceIndexService);
      const reader = module.get<ProjectResourceReaderService>(PROJECT_RESOURCE_READER);
      expect(port).toBe(service);
      const snapshot = await reader.readProject('homesite-registered');
      expect(snapshot).toMatchObject({ projectId: 'homesite-registered', complete: true });
      expect(snapshot.files.length).toBeGreaterThan(0);
      const index = vi.spyOn(service, 'index').mockResolvedValue({ projectId: 'homesite-registered' } as Awaited<ReturnType<ProjectResourceIndexService['index']>>);
      await port.refreshForSession('homesite-session', {});
      expect(index).toHaveBeenCalledWith('homesite-registered', {});
      await expect(port.refreshForSession('unknown-session', {})).rejects.toThrow('PROJECT_CONTEXT_SESSION_PROJECT_REQUIRED');
      const vfsProviders = Reflect.getMetadata('providers', VFSModule) as unknown[];
      const memoryProviders = Reflect.getMetadata('providers', MemoryModule) as unknown[];
      expect(vfsProviders).toContainEqual({ provide: PROJECT_RESOURCE_READER, useExisting: ProjectResourceReaderService });
      expect(memoryProviders).toContainEqual({ provide: PROJECT_CONTEXT_PORT, useExisting: ProjectResourceIndexService });
    } finally { await module.close(); sql.close(); }
  });
});
