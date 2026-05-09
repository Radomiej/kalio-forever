import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VFSGrepSearchTool, VFSFileSearchTool } from './vfs-search.tools';
import type { VFSService } from '../../vfs/vfs.service';
import type { ToolCallRequest } from '@kalio/types';

function makeRequest(toolName: string, args: Record<string, unknown> = {}, sessionId = 'sess-abc'): ToolCallRequest {
  return { callId: 'call-1', sessionId, toolName, args };
}

// ── VFSGrepSearchTool ─────────────────────────────────────────────────────────

describe('VFSGrepSearchTool', () => {
  let tool: VFSGrepSearchTool;
  let vfs: Partial<VFSService>;

  beforeEach(() => {
    vfs = {
      listFiles: vi.fn(),
      readFile: vi.fn(),
    };
    tool = new VFSGrepSearchTool(vfs as VFSService);
  });

  describe('positive scenarios', () => {
    it('returns matches with file, line, and text', async () => {
      (vfs.listFiles as ReturnType<typeof vi.fn>).mockReturnValue({
        sessionId: 'sess-abc',
        files: [{ path: 'hello.txt', sizeBytes: 20 }],
      });
      (vfs.readFile as ReturnType<typeof vi.fn>).mockReturnValue({
        sessionId: 'sess-abc',
        filePath: 'hello.txt',
        content: 'hello world\nno match here\nhello again',
      });

      const result = await tool.execute(makeRequest('vfs_grep_search', { query: 'hello' }));

      expect(result.matches).toHaveLength(2);
      expect(result.matches[0]).toEqual({ file: 'hello.txt', line: 1, text: 'hello world' });
      expect(result.matches[1]).toEqual({ file: 'hello.txt', line: 3, text: 'hello again' });
      expect(result.total).toBe(2);
    });

    it('searches across multiple files', async () => {
      (vfs.listFiles as ReturnType<typeof vi.fn>).mockReturnValue({
        sessionId: 'sess-abc',
        files: [
          { path: 'a.txt', sizeBytes: 10 },
          { path: 'b.txt', sizeBytes: 10 },
        ],
      });
      (vfs.readFile as ReturnType<typeof vi.fn>)
        .mockReturnValueOnce({ sessionId: 'sess-abc', filePath: 'a.txt', content: 'needle in a' })
        .mockReturnValueOnce({ sessionId: 'sess-abc', filePath: 'b.txt', content: 'needle in b' });

      const result = await tool.execute(makeRequest('vfs_grep_search', { query: 'needle' }));

      expect(result.matches).toHaveLength(2);
      expect(result.matches[0].file).toBe('a.txt');
      expect(result.matches[1].file).toBe('b.txt');
    });

    it('treats query as regex when isRegexp=true', async () => {
      (vfs.listFiles as ReturnType<typeof vi.fn>).mockReturnValue({
        sessionId: 'sess-abc',
        files: [{ path: 'code.ts', sizeBytes: 50 }],
      });
      (vfs.readFile as ReturnType<typeof vi.fn>).mockReturnValue({
        sessionId: 'sess-abc',
        filePath: 'code.ts',
        content: 'function foo() {}\nconst bar = 42;\nfunction baz() {}',
      });

      const result = await tool.execute(makeRequest('vfs_grep_search', { query: 'function \\w+', isRegexp: true }));

      expect(result.matches).toHaveLength(2);
      expect(result.matches[0].text).toContain('function foo');
      expect(result.matches[1].text).toContain('function baz');
    });
  });

  describe('edge cases', () => {
    it('filters files by includePattern glob', async () => {
      (vfs.listFiles as ReturnType<typeof vi.fn>).mockReturnValue({
        sessionId: 'sess-abc',
        files: [
          { path: 'script.ts', sizeBytes: 10 },
          { path: 'readme.md', sizeBytes: 10 },
        ],
      });
      (vfs.readFile as ReturnType<typeof vi.fn>).mockReturnValue({
        sessionId: 'sess-abc',
        filePath: 'script.ts',
        content: 'search_term here',
      });

      const result = await tool.execute(
        makeRequest('vfs_grep_search', { query: 'search_term', includePattern: '**/*.ts' }),
      );

      expect(vfs.readFile).toHaveBeenCalledTimes(1);
      expect(result.matches).toHaveLength(1);
      expect(result.matches[0].file).toBe('script.ts');
    });

    it('respects maxResults cap', async () => {
      const files = Array.from({ length: 5 }, (_, i) => ({ path: `file${i}.txt`, sizeBytes: 20 }));
      (vfs.listFiles as ReturnType<typeof vi.fn>).mockReturnValue({
        sessionId: 'sess-abc',
        files,
      });
      (vfs.readFile as ReturnType<typeof vi.fn>).mockReturnValue({
        sessionId: 'sess-abc',
        filePath: 'x.txt',
        content: 'match line',
      });

      const result = await tool.execute(makeRequest('vfs_grep_search', { query: 'match', maxResults: 3 }));

      expect(result.matches.length).toBeLessThanOrEqual(3);
      expect(result.total).toBeLessThanOrEqual(3);
    });

    it('returns empty result when no files in session', async () => {
      (vfs.listFiles as ReturnType<typeof vi.fn>).mockReturnValue({
        sessionId: 'sess-abc',
        files: [],
      });

      const result = await tool.execute(makeRequest('vfs_grep_search', { query: 'anything' }));

      expect(result.matches).toHaveLength(0);
      expect(result.total).toBe(0);
    });

    it('skips files that fail to read (does not throw)', async () => {
      (vfs.listFiles as ReturnType<typeof vi.fn>).mockReturnValue({
        sessionId: 'sess-abc',
        // bad.txt is listed first so it's the first readFile call (which throws)
        files: [
          { path: 'bad.txt', sizeBytes: 10 },
          { path: 'good.txt', sizeBytes: 10 },
        ],
      });
      (vfs.readFile as ReturnType<typeof vi.fn>)
        .mockImplementationOnce(() => { throw new Error('read error'); })
        .mockReturnValueOnce({ sessionId: 'sess-abc', filePath: 'good.txt', content: 'target text' });

      const result = await tool.execute(makeRequest('vfs_grep_search', { query: 'target' }));

      expect(result.matches).toHaveLength(1);
      expect(result.matches[0].file).toBe('good.txt');
    });

    it('truncates match text to 300 chars', async () => {
      const longLine = 'x'.repeat(400);
      (vfs.listFiles as ReturnType<typeof vi.fn>).mockReturnValue({
        sessionId: 'sess-abc',
        files: [{ path: 'long.txt', sizeBytes: 400 }],
      });
      (vfs.readFile as ReturnType<typeof vi.fn>).mockReturnValue({
        sessionId: 'sess-abc',
        filePath: 'long.txt',
        content: longLine,
      });

      const result = await tool.execute(makeRequest('vfs_grep_search', { query: 'x' }));

      expect(result.matches[0].text.length).toBe(300);
    });
  });

  describe('negative scenarios', () => {
    it('returns empty matches for invalid regex pattern', async () => {
      (vfs.listFiles as ReturnType<typeof vi.fn>).mockReturnValue({
        sessionId: 'sess-abc',
        files: [{ path: 'notes.txt', sizeBytes: 10 }],
      });

      // '[unclosed' is an invalid regex pattern - must not throw
      const result = await tool.execute(
        makeRequest('vfs_grep_search', { query: '[unclosed', isRegexp: true }),
      );

      expect(result.matches).toHaveLength(0);
      expect(result.total).toBe(0);
      expect(vfs.readFile).not.toHaveBeenCalled();
    });

    it('returns no matches when query does not match any content', async () => {
      (vfs.listFiles as ReturnType<typeof vi.fn>).mockReturnValue({
        sessionId: 'sess-abc',
        files: [{ path: 'notes.txt', sizeBytes: 10 }],
      });
      (vfs.readFile as ReturnType<typeof vi.fn>).mockReturnValue({
        sessionId: 'sess-abc',
        filePath: 'notes.txt',
        content: 'completely different content',
      });

      const result = await tool.execute(makeRequest('vfs_grep_search', { query: 'zzznomatch' }));

      expect(result.matches).toHaveLength(0);
    });

    it('returns no matches when includePattern matches no files', async () => {
      (vfs.listFiles as ReturnType<typeof vi.fn>).mockReturnValue({
        sessionId: 'sess-abc',
        files: [{ path: 'notes.txt', sizeBytes: 10 }],
      });

      const result = await tool.execute(
        makeRequest('vfs_grep_search', { query: 'anything', includePattern: '**/*.ts' }),
      );

      expect(vfs.readFile).not.toHaveBeenCalled();
      expect(result.matches).toHaveLength(0);
    });
  });
});

// ── VFSFileSearchTool ─────────────────────────────────────────────────────────

describe('VFSFileSearchTool', () => {
  let tool: VFSFileSearchTool;
  let vfs: Partial<VFSService>;

  beforeEach(() => {
    vfs = {
      listFiles: vi.fn(),
    };
    tool = new VFSFileSearchTool(vfs as VFSService);
  });

  describe('positive scenarios', () => {
    it('returns files matching glob pattern', async () => {
      (vfs.listFiles as ReturnType<typeof vi.fn>).mockReturnValue({
        sessionId: 'sess-abc',
        files: [
          { path: 'src/main.ts', sizeBytes: 100 },
          { path: 'src/app.ts', sizeBytes: 200 },
          { path: 'README.md', sizeBytes: 50 },
        ],
      });

      const result = await tool.execute(makeRequest('vfs_file_search', { pattern: '**/*.ts' }));

      expect(result.files).toHaveLength(2);
      expect(result.files).toContain('src/main.ts');
      expect(result.files).toContain('src/app.ts');
      expect(result.total).toBe(2);
    });

    it('matches exact filename pattern', async () => {
      (vfs.listFiles as ReturnType<typeof vi.fn>).mockReturnValue({
        sessionId: 'sess-abc',
        files: [
          { path: 'notes/work.md', sizeBytes: 10 },
          { path: 'notes/personal.md', sizeBytes: 10 },
          { path: 'code/main.ts', sizeBytes: 10 },
        ],
      });

      const result = await tool.execute(makeRequest('vfs_file_search', { pattern: 'notes/*.md' }));

      expect(result.files).toHaveLength(2);
      expect(result.total).toBe(2);
    });
  });

  describe('edge cases', () => {
    it('returns empty array when no files match pattern', async () => {
      (vfs.listFiles as ReturnType<typeof vi.fn>).mockReturnValue({
        sessionId: 'sess-abc',
        files: [{ path: 'README.md', sizeBytes: 10 }],
      });

      const result = await tool.execute(makeRequest('vfs_file_search', { pattern: '**/*.ts' }));

      expect(result.files).toHaveLength(0);
      expect(result.total).toBe(0);
    });

    it('respects maxResults cap', async () => {
      const files = Array.from({ length: 20 }, (_, i) => ({ path: `file${i}.ts`, sizeBytes: 10 }));
      (vfs.listFiles as ReturnType<typeof vi.fn>).mockReturnValue({
        sessionId: 'sess-abc',
        files,
      });

      const result = await tool.execute(makeRequest('vfs_file_search', { pattern: '**/*.ts', maxResults: 5 }));

      expect(result.files).toHaveLength(5);
      expect(result.total).toBe(5);
    });

    it('returns empty when session has no files', async () => {
      (vfs.listFiles as ReturnType<typeof vi.fn>).mockReturnValue({
        sessionId: 'sess-abc',
        files: [],
      });

      const result = await tool.execute(makeRequest('vfs_file_search', { pattern: '**/*' }));

      expect(result.files).toHaveLength(0);
    });

    it('defaults maxResults to 100', async () => {
      const files = Array.from({ length: 150 }, (_, i) => ({ path: `file${i}.txt`, sizeBytes: 10 }));
      (vfs.listFiles as ReturnType<typeof vi.fn>).mockReturnValue({
        sessionId: 'sess-abc',
        files,
      });

      const result = await tool.execute(makeRequest('vfs_file_search', { pattern: '**/*.txt' }));

      expect(result.files).toHaveLength(100);
    });
  });

  describe('negative scenarios', () => {
    it('does not throw for glob patterns with special chars', async () => {
      (vfs.listFiles as ReturnType<typeof vi.fn>).mockReturnValue({
        sessionId: 'sess-abc',
        files: [],
      });

      await expect(
        tool.execute(makeRequest('vfs_file_search', { pattern: '(special).ts' })),
      ).resolves.toBeDefined();
    });

    it('propagates error when VFSService.listFiles throws', async () => {
      (vfs.listFiles as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error('VFS_IO_ERROR');
      });

      await expect(tool.execute(makeRequest('vfs_file_search', { pattern: '**/*' }))).rejects.toThrow('VFS_IO_ERROR');
    });
  });
});
