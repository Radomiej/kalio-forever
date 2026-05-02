import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { VFSService } from './vfs.service';
import { mkdirSync, writeFileSync, rmdirSync, rmSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import * as os from 'node:os';

// Regression test for: VFS Path Traversal Guard fails on Windows
// Issue: The path traversal check uses hardcoded '/' but Windows uses '\'

describe('VFSService', () => {
  let service: VFSService;
  let configService: ConfigService;
  let testWorkspace: string;
  let sessionId: string;

  beforeEach(async () => {
    // Create temporary workspace for tests
    testWorkspace = join(os.tmpdir(), `kalio-vfs-test-${Date.now()}`);
    mkdirSync(testWorkspace, { recursive: true });

    sessionId = 'test-ws-123';
    mkdirSync(join(testWorkspace, 'sessions', sessionId, 'files'), { recursive: true });

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        VFSService,
        {
          provide: ConfigService,
          useValue: {
            get: vi.fn().mockReturnValue(testWorkspace),
          },
        },
      ],
    }).compile();

    service = moduleRef.get<VFSService>(VFSService);
    configService = moduleRef.get<ConfigService>(ConfigService);
  });

  afterEach(() => {
    // Cleanup test workspace
    try {
      if (existsSync(testWorkspace)) {
        rmSync(testWorkspace, { recursive: true, force: true });
      }
    } catch {
      // ignore cleanup errors
    }
  });

  describe('resolveSafe - Path Traversal Guard (REGRESSION TEST)', () => {
    it('should reject path traversal with double dots on all platforms', () => {
      // Arrange
      const maliciousPath = '../../../etc/passwd';

      // Act & Assert
      expect(() => {
        (service as any).resolveSafe(sessionId, maliciousPath);
      }).toThrow(/PATH_TRAVERSAL_DENIED/);
    });

    it('should reject path traversal with encoded separators', () => {
      const maliciousPaths = [
        '..\\..\\..\\windows\\system32\\config\\sam',
        '..\x2f..\x2fetc\x2fpasswd',
        '..%2f..%2f..%2fetc%2fpasswd',
      ];

      for (const maliciousPath of maliciousPaths) {
        expect(() => {
          (service as any).resolveSafe(sessionId, maliciousPath);
        }).toThrow(/PATH_TRAVERSAL_DENIED/);
      }
    });

    it('should reject absolute path outside workspace', () => {
      const absolutePath = process.platform === 'win32' ? 'C:\\Windows\\System32' : '/etc/passwd';

      expect(() => {
        (service as any).resolveSafe(sessionId, absolutePath);
      }).toThrow(/PATH_TRAVERSAL_DENIED/);
    });

    it('should reject accessing sibling workspace directory', () => {
      // This test specifically targets the Windows path separator issue
      const siblingTraversal = '..\\..\\other-workspace\\files\\secret.txt';

      expect(() => {
        (service as any).resolveSafe(sessionId, siblingTraversal);
      }).toThrow(/PATH_TRAVERSAL_DENIED/);
    });

    it('should allow valid relative paths', () => {
      const validPaths = [
        'file.txt',
        'subdir/file.txt',
        'deep/nested/path/file.txt',
        './relative.txt',
      ];

      for (const validPath of validPaths) {
        expect(() => {
          (service as any).resolveSafe(sessionId, validPath);
        }).not.toThrow();
      }
    });

    it('should handle mixed path separators correctly (Windows regression)', () => {
      // This test specifically checks the Windows path separator issue
      // The bug: base + '/' doesn't match Windows paths with '\'
      const mixedSeparators = 'subdir\\\\file.txt'; // double backslash

      // Should NOT throw for valid subdir path
      expect(() => {
        (service as any).resolveSafe(sessionId, mixedSeparators);
      }).not.toThrow();

      // Verify the resolved path is within workspace
      const result = (service as any).resolveSafe(sessionId, 'subdir/file.txt');
      const baseDir = resolve(join(testWorkspace, 'sessions', sessionId, 'files'));
      expect(result.startsWith(baseDir) || result.startsWith(baseDir + '\\') || result.startsWith(baseDir + '/')).toBe(true);
    });
  });

  describe('writeFile', () => {
    it('should write file within workspace', () => {
      service.writeFile({
        sessionId,
        filePath: 'test-file.txt',
        content: 'Hello World',
      });

      const filePath = join(testWorkspace, 'sessions', sessionId, 'files', 'test-file.txt');
      expect(existsSync(filePath)).toBe(true);
    });

    it('should reject writing outside workspace (regression test)', () => {
      expect(() => {
        service.writeFile({
          sessionId,
          filePath: '../../../etc/malicious.txt',
          content: 'malicious content',
        });
      }).toThrow(/PATH_TRAVERSAL_DENIED/);
    });
  });

  describe('readFile', () => {
    it('should read file within workspace', () => {
      // Setup
      const filePath = join(testWorkspace, 'sessions', sessionId, 'files', 'readable.txt');
      writeFileSync(filePath, 'test content', 'utf8');

      // Act
      const result = service.readFile(sessionId, 'readable.txt');

      // Assert
      expect(result.content).toBe('test content');
    });

    it('should reject reading outside workspace (regression test)', () => {
      expect(() => {
        service.readFile(sessionId, '../../../etc/passwd');
      }).toThrow(/PATH_TRAVERSAL_DENIED/);
    });
  });

  describe('deleteFile', () => {
    it('should delete an existing file', () => {
      const filePath = join(testWorkspace, 'sessions', sessionId, 'files', 'to-delete.txt');
      writeFileSync(filePath, 'data', 'utf8');
      expect(existsSync(filePath)).toBe(true);

      service.deleteFile(sessionId, 'to-delete.txt');
      expect(existsSync(filePath)).toBe(false);
    });

    it('throws when file does not exist', () => {
      expect(() => service.deleteFile(sessionId, 'nonexistent.txt')).toThrow();
    });
  });

  describe('writeBinary / readBinary', () => {
    it('should write and read binary data round-trip', () => {
      const buffer = Buffer.from([0x00, 0x01, 0x02, 0xff]);
      service.writeBinary(sessionId, 'binary.bin', buffer);
      const result = service.readBinary(sessionId, 'binary.bin');
      expect(result).toEqual(buffer);
    });

    it('readBinary throws VFS_FILE_NOT_FOUND for missing file', () => {
      expect(() => service.readBinary(sessionId, 'missing.bin')).toThrow('VFS_FILE_NOT_FOUND');
    });
  });

  describe('listFiles', () => {
    it('returns empty array when session directory does not exist', () => {
      const result = service.listFiles('no-such-session');
      expect(result.files).toEqual([]);
    });

    it('lists files including nested directories', () => {
      const filesDir = join(testWorkspace, 'sessions', sessionId, 'files');
      writeFileSync(join(filesDir, 'root.txt'), 'root', 'utf8');
      mkdirSync(join(filesDir, 'sub'), { recursive: true });
      writeFileSync(join(filesDir, 'sub', 'nested.txt'), 'nested', 'utf8');

      const result = service.listFiles(sessionId);
      const paths = result.files.map((f) => f.path);
      expect(paths).toContain('root.txt');
      expect(paths.some((p) => p.includes('nested.txt'))).toBe(true);
    });
  });

  describe('copySessionFiles', () => {
    it('copies all child session files into a prefixed master directory', () => {
      service.writeFile({ sessionId: 'child-session', filePath: 'site/index.html', content: '<h1>Hello</h1>' });
      service.writeFile({ sessionId: 'child-session', filePath: 'site/style.css', content: 'body{}' });

      const copied = service.copySessionFiles({
        fromSessionId: 'child-session',
        toSessionId: sessionId,
        targetPrefix: 'sub-agents/child-session',
      });

      expect(copied.map((file) => file.toPath).sort()).toEqual([
        'sub-agents/child-session/site/index.html',
        'sub-agents/child-session/site/style.css',
      ]);
      expect(service.readFile(sessionId, 'sub-agents/child-session/site/index.html').content).toBe('<h1>Hello</h1>');
    });

    it('copies selected child files only', () => {
      service.writeFile({ sessionId: 'child-session', filePath: 'a.txt', content: 'A' });
      service.writeFile({ sessionId: 'child-session', filePath: 'b.txt', content: 'B' });

      const copied = service.copySessionFiles({
        fromSessionId: 'child-session',
        toSessionId: sessionId,
        targetPrefix: 'sub-agents/child-session',
        filePaths: ['b.txt'],
      });

      expect(copied).toEqual([{ fromPath: 'b.txt', toPath: 'sub-agents/child-session/b.txt', sizeBytes: 1 }]);
      expect(service.readFile(sessionId, 'sub-agents/child-session/b.txt').content).toBe('B');
      expect(() => service.readFile(sessionId, 'sub-agents/child-session/a.txt')).toThrow();
    });

    it('rejects unsafe copy target prefixes', () => {
      service.writeFile({ sessionId: 'child-session', filePath: 'a.txt', content: 'A' });

      expect(() => service.copySessionFiles({
        fromSessionId: 'child-session',
        toSessionId: sessionId,
        targetPrefix: '../escaped',
      })).toThrow(/PATH_TRAVERSAL_DENIED/);
    });
  });

  describe('resolveSafe - invalid percent encoding', () => {
    it('falls back gracefully when decodeURIComponent throws (invalid percent encoding)', () => {
      // '%xyz' has invalid percent encoding - decodeURIComponent throws
      // The service falls back to using the raw string - which is a valid filename
      // It should not throw PATH_TRAVERSAL_DENIED for a safe relative path
      const result = (service as unknown as { resolveSafe: (s: string, p: string) => string })
        .resolveSafe(sessionId, '%xyz-file.txt');
      expect(result).toBeTruthy();
      // Combined traversal + invalid encoding should still be blocked
      expect(() => {
        (service as unknown as { resolveSafe: (s: string, p: string) => string })
          .resolveSafe(sessionId, '%2e%2e%2f%2e%2e%2fetc%2fpasswd');
      }).toThrow(/PATH_TRAVERSAL_DENIED/);
    });
  });
});

