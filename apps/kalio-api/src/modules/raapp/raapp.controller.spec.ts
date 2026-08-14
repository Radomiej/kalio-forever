import { PassThrough } from 'node:stream';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import { NotFoundException, ForbiddenException, BadRequestException, StreamableFile } from '@nestjs/common';
import { RAAppController } from './raapp.controller';
import { RAAppService } from './raapp.service';
import { RAAppVersioningService } from './raapp-versioning.service';
import { RAAppHITLService } from './raapp-hitl.service';
import type { LoadedRAApp } from './raapp.service';

function makeApp(overrides: Partial<LoadedRAApp> = {}): LoadedRAApp {
  return {
    id: 'app-1',
    zipPath: '/apps/app-1.zip',
    meta: {
      id: 'app-1',
      name: 'Test App',
      description: 'A test app',
      version: '1.0',
      tags: ['test'],
      expose_as_tool: false,
      tool_description: 'does testing',
    },
    source: 'core',
    htmlContent: '<html></html>',
    guiContent: null,
    systemsContent: null,
    appMode: 'display',
    createdAt: 1000000,
    updatedAt: 1000000,
    ...overrides,
  };
}

describe('RAAppController', () => {
  let controller: RAAppController;
  const mockService = {
    getAll: vi.fn(),
    getById: vi.fn(),
    saveUpload: vi.fn(),
    delete: vi.fn(),
  };
  const mockVersioningService = {
    getGroups: vi.fn().mockReturnValue([]),
    getGroupBySlug: vi.fn().mockReturnValue(null),
    saveAsDraft: vi.fn(),
    approveDraft: vi.fn(),
    deleteGroup: vi.fn(),
    discardDraft: vi.fn(),
    rollback: vi.fn(),
    downloadRelease: vi.fn(),
  };
  const mockHitlService = {
    getAllPendingApprovals: vi.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [RAAppController],
      providers: [
        { provide: RAAppService, useValue: mockService },
        { provide: RAAppVersioningService, useValue: mockVersioningService },
        { provide: RAAppHITLService, useValue: mockHitlService },
      ],
    }).compile();

    controller = module.get(RAAppController);
    vi.clearAllMocks();
  });

  describe('list()', () => {
    it('returns mapped array of all apps', () => {
      const app = makeApp({ source: 'user' });
      mockService.getAll.mockReturnValue([app]);

      const result = controller.list();
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('app-1');
      expect(result[0].name).toBe('Test App');
      expect(result[0].source).toBe('user');
    });

    it('returns empty array when no apps', () => {
      mockService.getAll.mockReturnValue([]);
      expect(controller.list()).toHaveLength(0);
    });

    it('maps optional meta fields with defaults', () => {
      const app = makeApp();
      app.meta.version = undefined;
      app.meta.description = undefined;
      app.meta.tags = undefined;
      mockService.getAll.mockReturnValue([app]);

      const [result] = controller.list();
      expect(result.version).toBe('1.0');
      expect(result.description).toBe('');
      expect(result.tags).toEqual([]);
    });

    it('filters out apps without renderable catalog content', () => {
      mockService.getAll.mockReturnValue([
        makeApp({ id: 'good-app' }),
        makeApp({ id: 'broken-app', htmlContent: null, guiContent: null }),
      ]);

      const result = controller.list();
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('good-app');
    });
  });

  describe('getOne()', () => {
    it('returns the app summary when found', () => {
      mockService.getById.mockReturnValue(makeApp());
      const result = controller.getOne('app-1');
      expect(result.id).toBe('app-1');
    });

    it('throws NotFoundException when app not found', () => {
      mockService.getById.mockReturnValue(undefined);
      expect(() => controller.getOne('missing')).toThrow(NotFoundException);
    });
  });

  describe('listPendingApprovals()', () => {
    it('returns pending RA-App approval snapshots for the global HITL inbox', async () => {
      mockHitlService.getAllPendingApprovals.mockResolvedValue([{
        id: 'approval-1',
        sessionId: 'session-1',
        toolCallId: 'call-1',
        system: 'vfs_write',
        args: { path: 'architecture.md' },
        displayLabel: 'write architecture.md',
        status: 'pending',
        createdAt: new Date('2026-07-02T12:00:00.000Z'),
      }]);

      await expect(controller.listPendingApprovals()).resolves.toEqual([{
        id: 'approval-1',
        sessionId: 'session-1',
        toolCallId: 'call-1',
        system: 'vfs_write',
        args: { path: 'architecture.md' },
        displayLabel: 'write architecture.md',
        status: 'pending',
        createdAt: Date.parse('2026-07-02T12:00:00.000Z'),
      }]);
    });
  });

  describe('upload()', () => {
    it('throws BadRequestException when no file provided', async () => {
      await expect(controller.upload(undefined as unknown as Express.Multer.File)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws BadRequestException for non-zip file', async () => {
      const file = { originalname: 'app.tar.gz', buffer: Buffer.from('') } as Express.Multer.File;
      await expect(controller.upload(file)).rejects.toThrow(BadRequestException);
    });

    it('calls saveUpload and returns summary for valid zip', async () => {
      const file = { originalname: 'app.zip', buffer: Buffer.from('fake-zip') } as Express.Multer.File;
      const app = makeApp({ source: 'user' });
      mockService.saveUpload.mockResolvedValue(app);

      const result = await controller.upload(file);
      expect(mockService.saveUpload).toHaveBeenCalledWith(file.buffer, 'app.zip');
      expect(result.id).toBe('app-1');
      expect(result.source).toBe('user');
    });
  });

  describe('remove()', () => {
    it('throws NotFoundException when app not found', async () => {
      mockService.getById.mockReturnValue(undefined);
      await expect(controller.remove('missing')).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException for core apps', async () => {
      mockService.getById.mockReturnValue(makeApp({ source: 'core' }));
      await expect(controller.remove('app-1')).rejects.toThrow(ForbiddenException);
    });

    it('deletes user app and returns ok', async () => {
      const app = makeApp({ source: 'user' });
      mockService.getById.mockReturnValue(app);
      mockService.delete.mockResolvedValue(undefined);

      const result = await controller.remove('app-1');
      expect(result).toEqual({ ok: true });
      expect(mockService.delete).toHaveBeenCalledWith('app-1');
    });
  });

  // ── Versioning / group endpoints ───────────────────────────────────────────

  describe('listGroups()', () => {
    it('returns all groups from versioning service', () => {
      const group = {
        slug: 'my-app',
        name: 'My App',
        source: 'user',
        current: { meta: { id: 'my-app', name: 'My App', version: '1.0.0' } },
        history: [],
      };
      mockVersioningService.getGroups.mockReturnValue([group]);
      mockService.getById.mockReturnValue(makeApp({ id: 'my-app' }));
      const result = controller.listGroups();
      expect(result).toHaveLength(1);
      expect(result[0].slug).toBe('my-app');
    });

    it('returns empty array when no groups', () => {
      mockVersioningService.getGroups.mockReturnValue([]);
      expect(controller.listGroups()).toEqual([]);
    });

    it('filters out groups whose current app has no renderable catalog content', () => {
      const visibleGroup = {
        slug: 'visible-app',
        name: 'Visible App',
        source: 'user',
        current: { meta: { id: 'visible-app', name: 'Visible App', version: '1.0.0' } },
        history: [],
      };
      const hiddenGroup = {
        slug: 'broken-app',
        name: 'Broken App',
        source: 'user',
        current: { meta: { id: 'broken-app', name: 'Broken App', version: '1.0.0' } },
        history: [],
      };
      mockVersioningService.getGroups.mockReturnValue([visibleGroup, hiddenGroup]);
      mockService.getById.mockImplementation((id: string) => {
        if (id === 'visible-app') {
          return makeApp({ id: 'visible-app' });
        }
        if (id === 'broken-app') {
          return makeApp({ id: 'broken-app', htmlContent: null, guiContent: null });
        }
        return undefined;
      });

      const result = controller.listGroups();
      expect(result).toHaveLength(1);
      expect(result[0].slug).toBe('visible-app');
    });
  });

  describe('getGroup()', () => {
    it('returns group when found', () => {
      const group = { slug: 'my-app', displayName: 'My App', currentVersion: null, draft: null, history: [] };
      mockVersioningService.getGroupBySlug.mockReturnValue(group);
      const result = controller.getGroup('my-app');
      expect(result.slug).toBe('my-app');
    });

    it('throws NotFoundException when group not found', () => {
      mockVersioningService.getGroupBySlug.mockReturnValue(null);
      expect(() => controller.getGroup('missing')).toThrow(NotFoundException);
    });
  });

  describe('saveDraft()', () => {
    it('throws BadRequestException when no file uploaded', async () => {
      await expect(
        controller.saveDraft('my-app', undefined as unknown as Express.Multer.File),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException for non-zip file', async () => {
      const file = { originalname: 'app.tar.gz', buffer: Buffer.from('') } as Express.Multer.File;
      await expect(controller.saveDraft('my-app', file)).rejects.toThrow(BadRequestException);
    });

    it('calls saveAsDraft for valid zip', async () => {
      const file = { originalname: 'app.zip', buffer: Buffer.from('zip-data') } as Express.Multer.File;
      const group = { slug: 'my-app', displayName: 'My App', currentVersion: null, draft: { version: '1.0.0' }, history: [] };
      mockVersioningService.saveAsDraft.mockResolvedValue(group);
      const result = await controller.saveDraft('my-app', file);
      expect(mockVersioningService.saveAsDraft).toHaveBeenCalledWith('my-app', file.buffer);
      expect(result.slug).toBe('my-app');
    });
  });

  describe('approveDraft()', () => {
    it('throws BadRequestException for invalid bumpType', async () => {
      const group = { slug: 'my-app', displayName: 'My App', currentVersion: null, draft: null, history: [] };
      mockVersioningService.getGroupBySlug.mockReturnValue(group);
      await expect(
        controller.approveDraft('my-app', { bumpType: 'invalid' as 'patch' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when group not found', async () => {
      mockVersioningService.getGroupBySlug.mockReturnValue(null);
      await expect(controller.approveDraft('missing', {})).rejects.toThrow(NotFoundException);
    });

    it('calls approveDraft with default bumpType minor', async () => {
      const group = { slug: 'my-app', displayName: 'My App', currentVersion: null, draft: null, history: [] };
      mockVersioningService.getGroupBySlug.mockReturnValue(group);
      mockVersioningService.approveDraft.mockResolvedValue(group);
      const result = await controller.approveDraft('my-app', {});
      expect(mockVersioningService.approveDraft).toHaveBeenCalledWith('my-app', 'minor');
      expect(result.slug).toBe('my-app');
    });

    it('calls approveDraft with specified bumpType', async () => {
      const group = { slug: 'my-app', displayName: 'My App', currentVersion: null, draft: null, history: [] };
      mockVersioningService.getGroupBySlug.mockReturnValue(group);
      mockVersioningService.approveDraft.mockResolvedValue(group);
      await controller.approveDraft('my-app', { bumpType: 'major' });
      expect(mockVersioningService.approveDraft).toHaveBeenCalledWith('my-app', 'major');
    });
  });

  describe('discardDraft()', () => {
    it('throws NotFoundException when group not found', async () => {
      mockVersioningService.getGroupBySlug.mockReturnValue(null);
      await expect(controller.discardDraft('missing')).rejects.toThrow(NotFoundException);
    });

    it('calls discardDraft when group found', async () => {
      const group = { slug: 'my-app', displayName: 'My App', currentVersion: null, draft: null, history: [] };
      mockVersioningService.getGroupBySlug.mockReturnValue(group);
      mockVersioningService.discardDraft = vi.fn().mockResolvedValue(group);
      const result = await controller.discardDraft('my-app');
      expect(result.slug).toBe('my-app');
    });
  });

  describe('rollback()', () => {
    it('throws NotFoundException when group not found', async () => {
      mockVersioningService.getGroupBySlug.mockReturnValue(null);
      await expect(controller.rollback('missing', '1.0.0')).rejects.toThrow(NotFoundException);
    });

    it('calls rollback when group found', async () => {
      const group = { slug: 'my-app', displayName: 'My App', currentVersion: null, draft: null, history: [] };
      mockVersioningService.getGroupBySlug.mockReturnValue(group);
      mockVersioningService.rollback = vi.fn().mockResolvedValue(group);
      const result = await controller.rollback('my-app', '1.0.0');
      expect(result.slug).toBe('my-app');
    });
  });

  describe('deleteGroup()', () => {
    it('throws NotFoundException when group not found', async () => {
      mockVersioningService.getGroupBySlug.mockReturnValue(null);
      await expect(controller.deleteGroup('missing')).rejects.toThrow(NotFoundException);
    });

    it('calls deleteGroup and returns ok', async () => {
      const group = { slug: 'my-app', displayName: 'My App', currentVersion: null, draft: null, history: [] };
      mockVersioningService.getGroupBySlug.mockReturnValue(group);
      mockVersioningService.deleteGroup.mockResolvedValue(undefined);
      const result = await controller.deleteGroup('my-app');
      expect(mockVersioningService.deleteGroup).toHaveBeenCalledWith('my-app');
      expect(result).toEqual({ ok: true });
    });
  });

  describe('downloadRelease()', () => {
    it('throws NotFoundException when group does not exist', () => {
      mockVersioningService.getGroupBySlug.mockReturnValue(null);

      expect(() =>
        (
          controller as unknown as {
            downloadRelease: (slug: string, version: string, res: { set: ReturnType<typeof vi.fn> }) => StreamableFile;
          }
        ).downloadRelease('missing', '1.2.0', { set: vi.fn() }),
      ).toThrow(NotFoundException);
    });

    it('streams the requested release zip with a versioned filename', () => {
      const stream = new PassThrough();
      const group = { slug: 'my-app', displayName: 'My App', currentVersion: null, draft: null, history: [] };
      mockVersioningService.getGroupBySlug.mockReturnValue(group);
      mockVersioningService.downloadRelease.mockReturnValue({
        stream,
        filename: 'my-app-1.2.0.zip',
      });
      const res = { set: vi.fn() };

      const result = (
        controller as unknown as {
          downloadRelease: (slug: string, version: string, res: { set: ReturnType<typeof vi.fn> }) => StreamableFile;
        }
      ).downloadRelease('my-app', '1.2.0', res);

      expect(mockVersioningService.downloadRelease).toHaveBeenCalledWith('my-app', '1.2.0');
      expect(res.set).toHaveBeenCalledWith({
        'Content-Type': 'application/zip',
        'Content-Disposition': 'attachment; filename="my-app-1.2.0.zip"',
      });
      expect(result).toBeInstanceOf(StreamableFile);
    });

    it('does not map missing release versions to NotFoundException from message text alone', () => {
      const group = { slug: 'my-app', displayName: 'My App', currentVersion: null, draft: null, history: [] };
      mockVersioningService.getGroupBySlug.mockReturnValue(group);
      mockVersioningService.downloadRelease.mockImplementation(() => {
        throw new Error('Release version not found: 9.9.9');
      });

      expect(() =>
        (
          controller as unknown as {
            downloadRelease: (slug: string, version: string, res: { set: ReturnType<typeof vi.fn> }) => StreamableFile;
          }
        ).downloadRelease('my-app', '9.9.9', { set: vi.fn() }),
      ).not.toThrow(NotFoundException);
    });

    it('maps release-not-found error codes to NotFoundException without relying on message text', () => {
      const group = { slug: 'my-app', displayName: 'My App', currentVersion: null, draft: null, history: [] };
      mockVersioningService.getGroupBySlug.mockReturnValue(group);
      mockVersioningService.downloadRelease.mockImplementation(() => {
        const err = new Error('zip missing');
        (err as NodeJS.ErrnoException).code = 'RAAPP_RELEASE_NOT_FOUND';
        throw err;
      });

      expect(() =>
        (
          controller as unknown as {
            downloadRelease: (slug: string, version: string, res: { set: ReturnType<typeof vi.fn> }) => StreamableFile;
          }
        ).downloadRelease('my-app', '9.9.9', { set: vi.fn() }),
      ).toThrow(NotFoundException);
    });
  });

  describe('deriveSlug()', () => {
    it('throws BadRequestException when no name', () => {
      expect(() => controller.deriveSlug({} as { name: string })).toThrow(BadRequestException);
      expect(() => controller.deriveSlug({ name: '' })).toThrow(BadRequestException);
    });

    it('returns derived slug for valid name', () => {
      const result = controller.deriveSlug({ name: 'My App' });
      expect(result).toEqual({ slug: 'my-app' });
    });
  });
});
