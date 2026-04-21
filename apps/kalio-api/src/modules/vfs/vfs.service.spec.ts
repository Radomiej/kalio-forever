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
  let conversationId: string;

  beforeEach(async () => {
    // Create temporary workspace for tests
    testWorkspace = join(os.tmpdir(), `kalio-vfs-test-${Date.now()}`);
    mkdirSync(testWorkspace, { recursive: true });

    conversationId = 'test-conv-123';
    mkdirSync(join(testWorkspace, 'conversations', conversationId, 'files'), { recursive: true });

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
        (service as any).resolveSafe(conversationId, maliciousPath);
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
          (service as any).resolveSafe(conversationId, maliciousPath);
        }).toThrow(/PATH_TRAVERSAL_DENIED/);
      }
    });

    it('should reject absolute path outside workspace', () => {
      const absolutePath = process.platform === 'win32' ? 'C:\\Windows\\System32' : '/etc/passwd';

      expect(() => {
        (service as any).resolveSafe(conversationId, absolutePath);
      }).toThrow(/PATH_TRAVERSAL_DENIED/);
    });

    it('should reject accessing sibling conversation directory', () => {
      // This test specifically targets the Windows path separator issue
      const siblingTraversal = '..\\..\\other-conversation\\files\\secret.txt';

      expect(() => {
        (service as any).resolveSafe(conversationId, siblingTraversal);
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
          (service as any).resolveSafe(conversationId, validPath);
        }).not.toThrow();
      }
    });

    it('should handle mixed path separators correctly (Windows regression)', () => {
      // This test specifically checks the Windows path separator issue
      // The bug: base + '/' doesn't match Windows paths with '\'
      const mixedSeparators = 'subdir\\\\file.txt'; // double backslash

      // Should NOT throw for valid subdir path
      expect(() => {
        (service as any).resolveSafe(conversationId, mixedSeparators);
      }).not.toThrow();

      // Verify the resolved path is within workspace
      const result = (service as any).resolveSafe(conversationId, 'subdir/file.txt');
      const baseDir = resolve(join(testWorkspace, 'conversations', conversationId, 'files'));
      expect(result.startsWith(baseDir) || result.startsWith(baseDir + '\\') || result.startsWith(baseDir + '/')).toBe(true);
    });
  });

  describe('writeFile', () => {
    it('should write file within conversation workspace', () => {
      service.writeFile({
        conversationId,
        filePath: 'test-file.txt',
        content: 'Hello World',
      });

      const filePath = join(testWorkspace, 'conversations', conversationId, 'files', 'test-file.txt');
      expect(existsSync(filePath)).toBe(true);
    });

    it('should reject writing outside conversation workspace (regression test)', () => {
      expect(() => {
        service.writeFile({
          conversationId,
          filePath: '../../../etc/malicious.txt',
          content: 'malicious content',
        });
      }).toThrow(/PATH_TRAVERSAL_DENIED/);
    });
  });

  describe('readFile', () => {
    it('should read file within conversation workspace', () => {
      // Setup
      const filePath = join(testWorkspace, 'conversations', conversationId, 'files', 'readable.txt');
      writeFileSync(filePath, 'test content', 'utf8');

      // Act
      const result = service.readFile(conversationId, 'readable.txt');

      // Assert
      expect(result.content).toBe('test content');
    });

    it('should reject reading outside conversation workspace (regression test)', () => {
      expect(() => {
        service.readFile(conversationId, '../../../etc/passwd');
      }).toThrow(/PATH_TRAVERSAL_DENIED/);
    });
  });
});
