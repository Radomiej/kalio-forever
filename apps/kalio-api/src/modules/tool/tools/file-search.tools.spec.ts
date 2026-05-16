import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GrepSearchTool, FileSearchTool } from './file-search.tools';
import type { AllowedPathsService } from '../../allowed-paths/allowed-paths.service';
import type { ToolCallRequest } from '@kalio/types';
import * as nodefs from 'node:fs';
import * as nodepath from 'node:path';

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  statSync: vi.fn(),
  readFileSync: vi.fn(),
  readdirSync: vi.fn(),
}));

function makeRequest(toolName: string, args: Record<string, unknown> = {}): ToolCallRequest {
  return { callId: 'call-1', sessionId: 'sess-fs', toolName, args };
}

// ── GrepSearchTool ────────────────────────────────────────────────────────────

describe('GrepSearchTool', () => {
  let tool: GrepSearchTool;
  let allowedPaths: Partial<AllowedPathsService>;

  beforeEach(() => {
    vi.clearAllMocks();
    allowedPaths = {
      getRoots: vi.fn(),
      isAllowed: vi.fn().mockResolvedValue(true),
    };
    tool = new GrepSearchTool(allowedPaths as AllowedPathsService);
  });

  describe('positive scenarios', () => {
    it('returns matches with file, line, and text', async () => {
      (allowedPaths.getRoots as ReturnType<typeof vi.fn>).mockResolvedValue(['/allowed']);
      vi.mocked(nodefs.existsSync).mockReturnValue(true);
      vi.mocked(nodefs.readdirSync).mockImplementation((dir) => {
        if (dir === '/allowed') {
          return [{ name: 'code.ts', isDirectory: () => false }] as unknown as ReturnType<typeof nodefs.readdirSync>;
        }
        return [] as unknown as ReturnType<typeof nodefs.readdirSync>;
      });
      vi.mocked(nodefs.statSync).mockReturnValue({ size: 100 } as ReturnType<typeof nodefs.statSync>);
      vi.mocked(nodefs.readFileSync).mockReturnValue('line one\nhello world\nline three');

      const result = await tool.execute(makeRequest('grep_search', { query: 'hello' }));

      expect(result.matches).toHaveLength(1);
      expect(result.matches[0].line).toBe(2);
      expect(result.matches[0].text).toContain('hello world');
      expect(result.total).toBe(1);
    });

    it('uses regex when isRegexp=true', async () => {
      (allowedPaths.getRoots as ReturnType<typeof vi.fn>).mockResolvedValue(['/allowed']);
      vi.mocked(nodefs.existsSync).mockReturnValue(true);
      vi.mocked(nodefs.readdirSync).mockImplementation((dir) => {
        if (dir === '/allowed') {
          return [{ name: 'app.ts', isDirectory: () => false }] as unknown as ReturnType<typeof nodefs.readdirSync>;
        }
        return [] as unknown as ReturnType<typeof nodefs.readdirSync>;
      });
      vi.mocked(nodefs.statSync).mockReturnValue({ size: 50 } as ReturnType<typeof nodefs.statSync>);
      vi.mocked(nodefs.readFileSync).mockReturnValue('function foo() {}\nconst x = 1;');

      const result = await tool.execute(makeRequest('grep_search', { query: 'function \\w+', isRegexp: true }));

      expect(result.matches).toHaveLength(1);
      expect(result.matches[0].text).toContain('function foo');
    });

    it('filters by includePattern glob', async () => {
      (allowedPaths.getRoots as ReturnType<typeof vi.fn>).mockResolvedValue(['/allowed']);
      vi.mocked(nodefs.existsSync).mockReturnValue(true);
      vi.mocked(nodefs.readdirSync).mockImplementation((dir) => {
        if (dir === '/allowed') {
          return [
            { name: 'script.ts', isDirectory: () => false },
            { name: 'readme.md', isDirectory: () => false },
          ] as unknown as ReturnType<typeof nodefs.readdirSync>;
        }
        return [] as unknown as ReturnType<typeof nodefs.readdirSync>;
      });
      vi.mocked(nodefs.statSync).mockReturnValue({ size: 30 } as ReturnType<typeof nodefs.statSync>);
      vi.mocked(nodefs.readFileSync).mockReturnValue('search_term here');

      const result = await tool.execute(makeRequest('grep_search', { query: 'search_term', includePattern: '**/*.ts' }));

      // Should only read the .ts file
      expect(nodefs.readFileSync).toHaveBeenCalledTimes(1);
      const callArg = (nodefs.readFileSync as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(callArg).toContain('script.ts');
    });
  });

  describe('edge cases', () => {
    it('returns empty result when no allowed roots configured', async () => {
      (allowedPaths.getRoots as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const result = await tool.execute(makeRequest('grep_search', { query: 'anything' }));

      expect(result.matches).toHaveLength(0);
      expect(result.total).toBe(0);
    });

    it('respects maxResults cap', async () => {
      (allowedPaths.getRoots as ReturnType<typeof vi.fn>).mockResolvedValue(['/allowed']);
      vi.mocked(nodefs.existsSync).mockReturnValue(true);
      const manyFiles = Array.from({ length: 10 }, (_, i) => ({
        name: `file${i}.txt`,
        isDirectory: () => false,
      }));
      vi.mocked(nodefs.readdirSync).mockImplementation((dir) => {
        if (dir === '/allowed') return manyFiles as unknown as ReturnType<typeof nodefs.readdirSync>;
        return [] as unknown as ReturnType<typeof nodefs.readdirSync>;
      });
      vi.mocked(nodefs.statSync).mockReturnValue({ size: 20 } as ReturnType<typeof nodefs.statSync>);
      vi.mocked(nodefs.readFileSync).mockReturnValue('match here');

      const result = await tool.execute(makeRequest('grep_search', { query: 'match', maxResults: 3 }));

      expect(result.total).toBeLessThanOrEqual(3);
    });

    it('skips files larger than 512KB', async () => {
      (allowedPaths.getRoots as ReturnType<typeof vi.fn>).mockResolvedValue(['/allowed']);
      vi.mocked(nodefs.existsSync).mockReturnValue(true);
      vi.mocked(nodefs.readdirSync).mockImplementation((dir) => {
        if (dir === '/allowed') {
          return [{ name: 'huge.bin', isDirectory: () => false }] as unknown as ReturnType<typeof nodefs.readdirSync>;
        }
        return [] as unknown as ReturnType<typeof nodefs.readdirSync>;
      });
      vi.mocked(nodefs.statSync).mockReturnValue({ size: 600 * 1024 } as ReturnType<typeof nodefs.statSync>);

      const result = await tool.execute(makeRequest('grep_search', { query: 'anything' }));

      expect(nodefs.readFileSync).not.toHaveBeenCalled();
      expect(result.matches).toHaveLength(0);
    });

    it('skips root directory that does not exist', async () => {
      (allowedPaths.getRoots as ReturnType<typeof vi.fn>).mockResolvedValue(['/nonexistent']);
      vi.mocked(nodefs.existsSync).mockReturnValue(false);

      const result = await tool.execute(makeRequest('grep_search', { query: 'x' }));

      expect(result.matches).toHaveLength(0);
    });
  });

  describe('negative scenarios', () => {
    it('skips files whose resolved path escapes the allowed roots via symlink', async () => {
      (allowedPaths.getRoots as ReturnType<typeof vi.fn>).mockResolvedValue(['/allowed']);
      (allowedPaths.isAllowed as ReturnType<typeof vi.fn>).mockResolvedValue(false);
      vi.mocked(nodefs.existsSync).mockReturnValue(true);
      vi.mocked(nodefs.readdirSync).mockImplementation((dir) => {
        if (dir === '/allowed') {
          return [{ name: 'link.txt', isDirectory: () => false }] as unknown as ReturnType<typeof nodefs.readdirSync>;
        }
        return [] as unknown as ReturnType<typeof nodefs.readdirSync>;
      });
      vi.mocked(nodefs.statSync).mockReturnValue({ size: 50 } as ReturnType<typeof nodefs.statSync>);
      vi.mocked(nodefs.readFileSync).mockReturnValue('secret content');

      const result = await tool.execute(makeRequest('grep_search', { query: 'secret' }));

      expect(allowedPaths.isAllowed).toHaveBeenCalledWith(nodepath.join('/allowed', 'link.txt'));
      expect(nodefs.readFileSync).not.toHaveBeenCalled();
      expect(result.matches).toHaveLength(0);
    });

    it('returns empty matches for invalid regex pattern', async () => {
      (allowedPaths.getRoots as ReturnType<typeof vi.fn>).mockResolvedValue(['/allowed']);
      vi.mocked(nodefs.existsSync).mockReturnValue(true);
      vi.mocked(nodefs.readdirSync).mockImplementation((dir) => {
        if (dir === '/allowed') {
          return [{ name: 'plain.txt', isDirectory: () => false }] as unknown as ReturnType<typeof nodefs.readdirSync>;
        }
        return [] as unknown as ReturnType<typeof nodefs.readdirSync>;
      });
      vi.mocked(nodefs.statSync).mockReturnValue({ size: 50 } as ReturnType<typeof nodefs.statSync>);
      vi.mocked(nodefs.readFileSync).mockReturnValue('some content');

      // '[unclosed' is an invalid regex pattern
      const result = await tool.execute(makeRequest('grep_search', { query: '[unclosed', isRegexp: true }));

      expect(result.matches).toHaveLength(0);
      expect(result.total).toBe(0);
    });

    it('returns no matches when query does not exist in any file', async () => {
      (allowedPaths.getRoots as ReturnType<typeof vi.fn>).mockResolvedValue(['/allowed']);
      vi.mocked(nodefs.existsSync).mockReturnValue(true);
      vi.mocked(nodefs.readdirSync).mockImplementation((dir) => {
        if (dir === '/allowed') {
          return [{ name: 'plain.txt', isDirectory: () => false }] as unknown as ReturnType<typeof nodefs.readdirSync>;
        }
        return [] as unknown as ReturnType<typeof nodefs.readdirSync>;
      });
      vi.mocked(nodefs.statSync).mockReturnValue({ size: 50 } as ReturnType<typeof nodefs.statSync>);
      vi.mocked(nodefs.readFileSync).mockReturnValue('no relevant content here');

      const result = await tool.execute(makeRequest('grep_search', { query: 'zzznomatch_xyz' }));

      expect(result.matches).toHaveLength(0);
    });
  });
});

// ── FileSearchTool ────────────────────────────────────────────────────────────

describe('FileSearchTool', () => {
  let tool: FileSearchTool;
  let allowedPaths: Partial<AllowedPathsService>;

  beforeEach(() => {
    vi.clearAllMocks();
    allowedPaths = {
      getRoots: vi.fn(),
      isAllowed: vi.fn().mockResolvedValue(true),
    };
    tool = new FileSearchTool(allowedPaths as AllowedPathsService);
  });

  describe('positive scenarios', () => {
    it('returns files matching a glob pattern', async () => {
      (allowedPaths.getRoots as ReturnType<typeof vi.fn>).mockResolvedValue(['/project']);
      vi.mocked(nodefs.existsSync).mockReturnValue(true);
      vi.mocked(nodefs.readdirSync).mockImplementation((dir) => {
        if (dir === '/project') {
          return [
            { name: 'src', isDirectory: () => true },
            { name: 'readme.md', isDirectory: () => false },
          ] as unknown as ReturnType<typeof nodefs.readdirSync>;
        }
        if (String(dir).includes('src')) {
          return [
            { name: 'index.ts', isDirectory: () => false },
            { name: 'app.ts', isDirectory: () => false },
          ] as unknown as ReturnType<typeof nodefs.readdirSync>;
        }
        return [] as unknown as ReturnType<typeof nodefs.readdirSync>;
      });

      const result = await tool.execute(makeRequest('file_search', { pattern: '**/*.ts' }));

      expect(result.files.length).toBeGreaterThan(0);
      expect(result.files.every((f: string) => f.endsWith('.ts'))).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('returns empty when no allowed roots are configured', async () => {
      (allowedPaths.getRoots as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const result = await tool.execute(makeRequest('file_search', { pattern: '**/*.ts' }));

      expect(result.files).toHaveLength(0);
      expect(result.total).toBe(0);
    });

    it('respects maxResults cap', async () => {
      (allowedPaths.getRoots as ReturnType<typeof vi.fn>).mockResolvedValue(['/project']);
      vi.mocked(nodefs.existsSync).mockReturnValue(true);
      const manyFiles = Array.from({ length: 200 }, (_, i) => ({
        name: `file${i}.ts`,
        isDirectory: () => false,
      }));
      vi.mocked(nodefs.readdirSync).mockImplementation((dir) => {
        if (dir === '/project') return manyFiles as unknown as ReturnType<typeof nodefs.readdirSync>;
        return [] as unknown as ReturnType<typeof nodefs.readdirSync>;
      });

      const result = await tool.execute(makeRequest('file_search', { pattern: '**/*.ts', maxResults: 10 }));

      expect(result.files.length).toBeLessThanOrEqual(10);
    });

    it('skips root that does not exist', async () => {
      (allowedPaths.getRoots as ReturnType<typeof vi.fn>).mockResolvedValue(['/not-here']);
      vi.mocked(nodefs.existsSync).mockReturnValue(false);

      const result = await tool.execute(makeRequest('file_search', { pattern: '**/*' }));

      expect(result.files).toHaveLength(0);
    });
  });

  describe('negative scenarios', () => {
    it('skips files whose resolved path escapes the allowed roots via symlink', async () => {
      (allowedPaths.getRoots as ReturnType<typeof vi.fn>).mockResolvedValue(['/project']);
      (allowedPaths.isAllowed as ReturnType<typeof vi.fn>).mockResolvedValue(false);
      vi.mocked(nodefs.existsSync).mockReturnValue(true);
      vi.mocked(nodefs.readdirSync).mockImplementation((dir) => {
        if (dir === '/project') {
          return [{ name: 'link.ts', isDirectory: () => false }] as unknown as ReturnType<typeof nodefs.readdirSync>;
        }
        return [] as unknown as ReturnType<typeof nodefs.readdirSync>;
      });

      const result = await tool.execute(makeRequest('file_search', { pattern: '**/*.ts' }));

      expect(allowedPaths.isAllowed).toHaveBeenCalledWith(nodepath.join('/project', 'link.ts'));
      expect(result.files).toHaveLength(0);
    });

    it('does not throw for any glob pattern (special chars are escaped)', async () => {
      (allowedPaths.getRoots as ReturnType<typeof vi.fn>).mockResolvedValue(['/project']);
      vi.mocked(nodefs.existsSync).mockReturnValue(true);
      vi.mocked(nodefs.readdirSync).mockReturnValue([] as unknown as ReturnType<typeof nodefs.readdirSync>);

      // Special chars that might break an unescaped regex
      await expect(tool.execute(makeRequest('file_search', { pattern: '(special).ts' }))).resolves.toBeDefined();
    });

    it('returns empty when pattern matches nothing', async () => {
      (allowedPaths.getRoots as ReturnType<typeof vi.fn>).mockResolvedValue(['/project']);
      vi.mocked(nodefs.existsSync).mockReturnValue(true);
      vi.mocked(nodefs.readdirSync).mockImplementation((dir) => {
        if (dir === '/project') {
          return [{ name: 'only.md', isDirectory: () => false }] as unknown as ReturnType<typeof nodefs.readdirSync>;
        }
        return [] as unknown as ReturnType<typeof nodefs.readdirSync>;
      });

      const result = await tool.execute(makeRequest('file_search', { pattern: '**/*.ts' }));

      expect(result.files).toHaveLength(0);
    });
  });
});
