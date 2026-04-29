import { describe, it, expect, beforeEach, vi } from 'vitest';
import { VFSService } from './vfs.service';
import { ConfigService } from '@nestjs/config';
import { writeFileSync, readFileSync, mkdirSync, existsSync, unlinkSync } from 'node:fs';

describe('VFSService - Resource Limits', () => {
  let service: VFSService;
  let mockConfig: any;
  let testDir: string;

  beforeEach(() => {
    testDir = `C:\\Temp\\vfs-test-${Date.now()}`;
    mockConfig = {
      get: vi.fn().mockReturnValue(testDir),
    };
    service = new VFSService(mockConfig);
  });

  describe('readFile - no file size limit BUG CONFIRMED', () => {
    it('should read large file without size limit', () => {
      // Arrange: Create a large file (10MB)
      mkdirSync(testDir, { recursive: true });
      const sessionDir = `${testDir}\\sessions\\test-session\\files`;
      mkdirSync(sessionDir, { recursive: true });
      
      const largeContent = 'x'.repeat(10 * 1024 * 1024); // 10MB
      writeFileSync(`${sessionDir}\\large.txt`, largeContent, 'utf8');

      // Act - Read the large file
      const result = service.readFile('test-session', 'large.txt');

      // Assert - BUG CONFIRMED: No size limit, entire file read into memory
      expect(result.content).toHaveLength(10 * 1024 * 1024);
      expect(result.content).toBe(largeContent);
    });

    it('should attempt to read extremely large file without protection', () => {
      // Arrange: Create a very large file (100MB) - this could cause memory exhaustion
      mkdirSync(testDir, { recursive: true });
      const sessionDir = `${testDir}\\sessions\\test-session\\files`;
      mkdirSync(sessionDir, { recursive: true });
      
      const hugeContent = 'x'.repeat(100 * 1024 * 1024); // 100MB
      writeFileSync(`${sessionDir}\\huge.txt`, hugeContent, 'utf8');

      // Act - Read the huge file
      const result = service.readFile('test-session', 'huge.txt');

      // Assert - BUG CONFIRMED: No size limit, entire file read into memory
      expect(result.content).toHaveLength(100 * 1024 * 1024);
    });

    it('should read file synchronously blocking event loop', () => {
      // Arrange: Create a large file
      mkdirSync(testDir, { recursive: true });
      const sessionDir = `${testDir}\\sessions\\test-session\\files`;
      mkdirSync(sessionDir, { recursive: true });
      
      const largeContent = 'x'.repeat(50 * 1024 * 1024); // 50MB
      writeFileSync(`${sessionDir}\\large.txt`, largeContent, 'utf8');

      // Act - Read the large file
      const startTime = Date.now();
      const result = service.readFile('test-session', 'large.txt');
      const duration = Date.now() - startTime;

      // Assert - BUG CONFIRMED: Synchronous read blocks event loop
      expect(result.content).toHaveLength(50 * 1024 * 1024);
      expect(duration).toBeGreaterThan(0); // Takes time to read
    });
  });

  describe('readBinary - no file size limit BUG CONFIRMED', () => {
    it('should read large binary file without size limit', () => {
      // Arrange: Create a large binary file
      mkdirSync(testDir, { recursive: true });
      const sessionDir = `${testDir}\\sessions\\test-session\\files`;
      mkdirSync(sessionDir, { recursive: true });
      
      const largeBuffer = Buffer.alloc(10 * 1024 * 1024); // 10MB
      writeFileSync(`${sessionDir}\\large.bin`, largeBuffer);

      // Act - Read the large binary file
      const result = service.readBinary('test-session', 'large.bin');

      // Assert - BUG CONFIRMED: No size limit, entire file read into memory
      expect(result.length).toBe(10 * 1024 * 1024);
    });
  });

  describe('downloadFile - no file size limit BUG CONFIRMED', () => {
    it('should create stream for large file without size limit', () => {
      // Arrange: Create a large file
      mkdirSync(testDir, { recursive: true });
      const sessionDir = `${testDir}\\sessions\\test-session\\files`;
      mkdirSync(sessionDir, { recursive: true });
      
      const largeContent = 'x'.repeat(10 * 1024 * 1024); // 10MB
      writeFileSync(`${sessionDir}\\large.txt`, largeContent, 'utf8');

      // Act - Download the large file
      const result = service.downloadFile('test-session', 'large.txt');

      // Assert - BUG CONFIRMED: No size limit, stream created for large file
      expect(result.stream).toBeDefined();
      expect(result.filename).toBe('large.txt');
    });
  });

  describe('listFiles - no recursion depth limit BUG CONFIRMED', () => {
    it('should walk deep directory structure without depth limit', () => {
      // Arrange: Create a deep directory structure (100 levels deep)
      mkdirSync(testDir, { recursive: true });
      const sessionDir = `${testDir}\\sessions\\test-session\\files`;
      mkdirSync(sessionDir, { recursive: true });
      
      let currentPath = sessionDir;
      for (let i = 0; i < 100; i++) {
        currentPath = `${currentPath}\\level${i}`;
        mkdirSync(currentPath, { recursive: true });
        writeFileSync(`${currentPath}\\file.txt`, `content${i}`, 'utf8');
      }

      // Act - List all files
      const result = service.listFiles('test-session');

      // Assert - BUG CONFIRMED: No depth limit, walks entire tree
      expect(result.files.length).toBe(100);
    });

    it('should list files from wide directory structure without limit', () => {
      // Arrange: Create a wide directory structure (1000 files in one directory)
      mkdirSync(testDir, { recursive: true });
      const sessionDir = `${testDir}\\sessions\\test-session\\files`;
      mkdirSync(sessionDir, { recursive: true });
      
      for (let i = 0; i < 1000; i++) {
        writeFileSync(`${sessionDir}\\file${i}.txt`, `content${i}`, 'utf8');
      }

      // Act - List all files
      const result = service.listFiles('test-session');

      // Assert - BUG CONFIRMED: No file count limit
      expect(result.files.length).toBe(1000);
    });
  });
});
