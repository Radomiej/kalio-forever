import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import { BadRequestException, UnsupportedMediaTypeException } from '@nestjs/common';
import { SessionVfsController } from './session-vfs.controller';
import { VFSService } from './vfs.service';
import { StreamableFile } from '@nestjs/common';
import type { VFSListResult, VFSReadResult } from '@kalio/types';
import { Readable } from 'node:stream';

describe('SessionVfsController', () => {
  let controller: SessionVfsController;
  const mockVfs = {
    listFiles: vi.fn(),
    writeFile: vi.fn(),
    touchSession: vi.fn(),
    readFile: vi.fn(),
    serveFile: vi.fn(),
    downloadFile: vi.fn(),
    writeBinary: vi.fn(),
    archiveSession: vi.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SessionVfsController],
      providers: [{ provide: VFSService, useValue: mockVfs }],
    }).compile();

    controller = module.get(SessionVfsController);
    vi.clearAllMocks();
  });

  describe('list()', () => {
    it('returns list of files for session', () => {
      const result: VFSListResult = { sessionId: 'sess-1', files: [{ sessionId: 'sess-1', path: 'output.txt', sizeBytes: 100, mimeType: 'text/plain', updatedAt: Date.now() }] };
      mockVfs.listFiles.mockReturnValue(result);

      expect(controller.list('sess-1')).toBe(result);
      expect(mockVfs.listFiles).toHaveBeenCalledWith('sess-1');
    });
  });

  describe('writeText()', () => {
    it('writes text file, touches the session, and returns ok', async () => {
      mockVfs.writeFile.mockReturnValue(undefined);
      mockVfs.touchSession.mockResolvedValue(undefined);
      const result = await controller.writeText('sess-1', { filePath: 'hello.txt', content: 'world' });
      expect(result).toEqual({ ok: true });
      expect(mockVfs.writeFile).toHaveBeenCalledWith({ sessionId: 'sess-1', filePath: 'hello.txt', content: 'world' });
      expect(mockVfs.touchSession).toHaveBeenCalledWith('sess-1');
    });

    it('throws BadRequest when filePath is missing', async () => {
      await expect(controller.writeText('sess-1', { filePath: '', content: 'x' })).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequest when content is undefined', async () => {
      await expect(
        controller.writeText('sess-1', { filePath: 'file.txt', content: undefined as unknown as string }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequest when vfs throws PATH_TRAVERSAL_DENIED', async () => {
      const err = Object.assign(new Error('traversal denied'), { code: 'PATH_TRAVERSAL_DENIED' });
      mockVfs.writeFile.mockImplementation(() => { throw err; });
      await expect(controller.writeText('sess-1', { filePath: '../etc/passwd', content: 'x' })).rejects.toThrow(BadRequestException);
    });

    it('re-throws non-traversal errors from vfs', async () => {
      mockVfs.writeFile.mockImplementation(() => { throw new Error('disk full'); });
      await expect(controller.writeText('sess-1', { filePath: 'file.txt', content: 'x' })).rejects.toThrow('disk full');
    });
  });

  describe('read()', () => {
    it('returns file content', () => {
      const readResult: VFSReadResult = { sessionId: 'sess-1', filePath: 'output.txt', content: 'hello world' };
      mockVfs.readFile.mockReturnValue(readResult);

      expect(controller.read('sess-1', 'output.txt')).toBe(readResult);
      expect(mockVfs.readFile).toHaveBeenCalledWith('sess-1', 'output.txt');
    });

    it('throws BadRequest for PATH_TRAVERSAL_DENIED', () => {
      const err = Object.assign(new Error('path traversal'), { code: 'PATH_TRAVERSAL_DENIED' });
      mockVfs.readFile.mockImplementation(() => { throw err; });
      expect(() => controller.read('sess-1', '../secret')).toThrow(BadRequestException);
    });

    it('re-throws other errors from vfs', () => {
      mockVfs.readFile.mockImplementation(() => { throw new Error('file not found'); });
      expect(() => controller.read('sess-1', 'missing.txt')).toThrow('file not found');
    });
  });

  describe('download()', () => {
    it('sets content-disposition header and returns StreamableFile', () => {
      const stream = Readable.from(['data']);
      mockVfs.downloadFile.mockReturnValue({ stream, filename: 'output.txt' });
      const res = { set: vi.fn() };

      const result = controller.download('sess-1', 'output.txt', res as never);
      expect(result).toBeInstanceOf(StreamableFile);
      expect(res.set).toHaveBeenCalledWith(
        expect.objectContaining({ 'Content-Disposition': 'attachment; filename="output.txt"' }),
      );
    });
  });

  describe('serve()', () => {
    it('sets content-type header from VFSService and returns StreamableFile', () => {
      mockVfs.serveFile.mockReturnValue({
        content: Buffer.from('<!doctype html><html></html>'),
        mimeType: 'text/html; charset=utf-8',
      });
      const res = { set: vi.fn() };

      const result = controller.serve('sess-1', 'design/preview.html', res as never);

      expect(result).toBeInstanceOf(StreamableFile);
      expect(mockVfs.serveFile).toHaveBeenCalledWith('sess-1', 'design/preview.html');
      expect(res.set).toHaveBeenCalledWith(
        expect.objectContaining({
          'Content-Type': 'text/html; charset=utf-8',
        }),
      );
    });

    it('throws BadRequest for PATH_TRAVERSAL_DENIED', () => {
      const err = Object.assign(new Error('path traversal'), { code: 'PATH_TRAVERSAL_DENIED' });
      mockVfs.serveFile.mockImplementation(() => {
        throw err;
      });

      expect(() => controller.serve('sess-1', '../secret.html', { set: vi.fn() } as never)).toThrow(BadRequestException);
    });

    it('returns StreamableFile for streamed assets too', () => {
      mockVfs.serveFile.mockReturnValue({
        stream: Readable.from(['body { color: red; }']),
        mimeType: 'text/css; charset=utf-8',
      });
      const res = { set: vi.fn() };

      const result = controller.serve('sess-1', 'design/style.css', res as never);

      expect(result).toBeInstanceOf(StreamableFile);
      expect(res.set).toHaveBeenCalledWith(
        expect.objectContaining({
          'Content-Type': 'text/css; charset=utf-8',
        }),
      );
    });

    it('serves path-based VFS assets for iframe previews', () => {
      mockVfs.serveFile.mockReturnValue({
        content: Buffer.from('<!doctype html><html></html>'),
        mimeType: 'text/html; charset=utf-8',
      });
      const res = { set: vi.fn() };

      const result = controller.servePath('sess-1', 'design/preview.html', res as never);

      expect(result).toBeInstanceOf(StreamableFile);
      expect(mockVfs.serveFile).toHaveBeenCalledWith('sess-1', 'design/preview.html');
    });

    it('falls back to the original URL when wildcard path binding is missing', () => {
      mockVfs.serveFile.mockReturnValue({
        content: Buffer.from('<!doctype html><html></html>'),
        mimeType: 'text/html; charset=utf-8',
      });
      const res = { set: vi.fn() };
      const req = {
        originalUrl: '/api/sessions/sess-1/vfs/serve-path/design/my%20preview.html',
      };

      const result = controller.servePath('sess-1', '' as never, res as never, req as never);

      expect(result).toBeInstanceOf(StreamableFile);
      expect(mockVfs.serveFile).toHaveBeenCalledWith('sess-1', 'design/my preview.html');
    });

    it('REGRESSION: strips the query string when resolving serve-path from originalUrl', () => {
      mockVfs.serveFile.mockReturnValue({
        content: Buffer.from('<!doctype html><html></html>'),
        mimeType: 'text/html; charset=utf-8',
      });
      const res = { set: vi.fn() };
      const req = {
        originalUrl: '/api/sessions/sess-1/vfs/serve-path/design/my%20preview.html?cacheBust=123',
      };

      const result = controller.servePath('sess-1', '' as never, res as never, req as never);

      expect(result).toBeInstanceOf(StreamableFile);
      expect(mockVfs.serveFile).toHaveBeenCalledWith('sess-1', 'design/my preview.html');
    });

    it('REGRESSION: throws BadRequest when neither wildcard binding nor originalUrl marker provides a path', () => {
      expect(() =>
        controller.servePath(
          'sess-1',
          '' as never,
          { set: vi.fn() } as never,
          { originalUrl: '/api/sessions/sess-1/vfs/serve?path=' } as never,
        ),
      ).toThrow(BadRequestException);
    });
  });

  describe('upload()', () => {
    it('throws BadRequest when no file provided', async () => {
      await expect(controller.upload('sess-1', undefined)).rejects.toThrow(BadRequestException);
    });

    it('throws UnsupportedMediaType for unsupported mime type', async () => {
      const file = { mimetype: 'text/plain', buffer: Buffer.from('') } as Express.Multer.File;
      await expect(controller.upload('sess-1', file)).rejects.toThrow(UnsupportedMediaTypeException);
    });

    it('uploads png, touches the session, and returns ChatAttachment', async () => {
      const file = { mimetype: 'image/png', buffer: Buffer.from('img-data') } as Express.Multer.File;
      mockVfs.writeBinary.mockReturnValue(undefined);
      mockVfs.touchSession.mockResolvedValue(undefined);

      const result = await controller.upload('sess-1', file);
      expect(result.mimeType).toBe('image/png');
      expect(result.path).toMatch(/^uploads\/.+\.png$/);
      expect(mockVfs.writeBinary).toHaveBeenCalledWith('sess-1', result.path, file.buffer);
      expect(mockVfs.touchSession).toHaveBeenCalledWith('sess-1');
    });

    it('uploads jpeg and returns ChatAttachment', async () => {
      const file = { mimetype: 'image/jpeg', buffer: Buffer.from('img-data') } as Express.Multer.File;
      mockVfs.writeBinary.mockReturnValue(undefined);
      mockVfs.touchSession.mockResolvedValue(undefined);

      const result = await controller.upload('sess-1', file);
      expect(result.mimeType).toBe('image/jpeg');
      expect(result.path).toMatch(/^uploads\/.+\.jpg$/);
    });

    it('uploads webp and returns ChatAttachment', async () => {
      const file = { mimetype: 'image/webp', buffer: Buffer.from('') } as Express.Multer.File;
      mockVfs.writeBinary.mockReturnValue(undefined);
      mockVfs.touchSession.mockResolvedValue(undefined);
      const result = await controller.upload('sess-1', file);
      expect(result.path).toMatch(/\.webp$/);
    });
  });

  describe('zip()', () => {
    it('returns StreamableFile with zip content-type', () => {
      const stream = Readable.from(['zip-data']);
      mockVfs.archiveSession.mockReturnValue(stream);
      const res = { set: vi.fn() };

      const result = controller.zip('sess-1', res as never);
      expect(result).toBeInstanceOf(StreamableFile);
      expect(res.set).toHaveBeenCalledWith(
        expect.objectContaining({
          'Content-Type': 'application/zip',
          'Content-Disposition': 'attachment; filename="session-sess-1.zip"',
        }),
      );
    });
  });
});
