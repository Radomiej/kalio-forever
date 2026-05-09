import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FsReadTool } from './fs-read.tool';
import { FsListTool } from './fs-list.tool';
import { FsWriteTool } from './fs-write.tool';
import type { AllowedPathsService } from '../../allowed-paths/allowed-paths.service';
import type { ToolCallRequest } from '@kalio/types';
import { Reflector } from '@nestjs/core';
import { TOOL_METADATA } from '../../../common/decorators/tool.decorator';

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  statSync: vi.fn(),
  readFileSync: vi.fn(),
  readdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

import * as nodefs from 'node:fs';

function makeRequest(toolName: string, args: Record<string, unknown> = {}, sessionId = 'sess-abc'): ToolCallRequest {
  return { callId: 'call-1', sessionId, toolName, args };
}

const ALLOWED_DIR = '/projects/myapp';

// ── FsReadTool ────────────────────────────────────────────────────────────────

describe('FsReadTool', () => {
  let tool: FsReadTool;
  let allowedPaths: Partial<AllowedPathsService>;

  beforeEach(() => {
    vi.clearAllMocks();
    allowedPaths = {
      isAllowed: vi.fn().mockResolvedValue(true),
    };
    tool = new FsReadTool(allowedPaths as AllowedPathsService);
  });

  describe('positive scenarios', () => {
    it('returns path, content and line count for an allowed file', async () => {
      vi.mocked(nodefs.existsSync).mockReturnValue(true);
      vi.mocked(nodefs.statSync).mockReturnValue({ isFile: () => true, size: 100 } as ReturnType<typeof nodefs.statSync>);
      vi.mocked(nodefs.readFileSync).mockReturnValue('line1\nline2\nline3');

      const result = await tool.execute(makeRequest('fs_read', { path: `${ALLOWED_DIR}/hello.ts` }));

      expect(result.content).toBe('line1\nline2\nline3');
      expect(result.lines).toBe(3);
    });

    it('returns line slice when startLine and endLine are provided', async () => {
      vi.mocked(nodefs.existsSync).mockReturnValue(true);
      vi.mocked(nodefs.statSync).mockReturnValue({ isFile: () => true, size: 100 } as ReturnType<typeof nodefs.statSync>);
      vi.mocked(nodefs.readFileSync).mockReturnValue('a\nb\nc\nd\ne');

      const result = await tool.execute(
        makeRequest('fs_read', { path: `${ALLOWED_DIR}/file.ts`, startLine: 2, endLine: 4 }),
      );

      expect(result.content).toBe('b\nc\nd');
      expect(result.lines).toBe(5);
    });

    it('uses 1 as default startLine when only endLine is given', async () => {
      vi.mocked(nodefs.existsSync).mockReturnValue(true);
      vi.mocked(nodefs.statSync).mockReturnValue({ isFile: () => true, size: 100 } as ReturnType<typeof nodefs.statSync>);
      vi.mocked(nodefs.readFileSync).mockReturnValue('x\ny\nz');

      const result = await tool.execute(
        makeRequest('fs_read', { path: `${ALLOWED_DIR}/file.ts`, endLine: 2 }),
      );

      expect(result.content).toBe('x\ny');
    });
  });

  describe('edge cases', () => {
    it('returns whole file when no startLine/endLine given', async () => {
      vi.mocked(nodefs.existsSync).mockReturnValue(true);
      vi.mocked(nodefs.statSync).mockReturnValue({ isFile: () => true, size: 50 } as ReturnType<typeof nodefs.statSync>);
      vi.mocked(nodefs.readFileSync).mockReturnValue('only line');

      const result = await tool.execute(makeRequest('fs_read', { path: `${ALLOWED_DIR}/single.txt` }));

      expect(result.content).toBe('only line');
    });
  });

  describe('negative scenarios', () => {
    it('throws ACCESS_DENIED when path is not in allowed roots', async () => {
      (allowedPaths.isAllowed as ReturnType<typeof vi.fn>).mockResolvedValue(false);

      await expect(
        tool.execute(makeRequest('fs_read', { path: '/etc/passwd' })),
      ).rejects.toThrow('ACCESS_DENIED');
    });

    it('throws NOT_FOUND when file does not exist', async () => {
      vi.mocked(nodefs.existsSync).mockReturnValue(false);

      await expect(
        tool.execute(makeRequest('fs_read', { path: `${ALLOWED_DIR}/missing.ts` })),
      ).rejects.toThrow('NOT_FOUND');
    });

    it('throws NOT_A_FILE when path is a directory', async () => {
      vi.mocked(nodefs.existsSync).mockReturnValue(true);
      vi.mocked(nodefs.statSync).mockReturnValue({ isFile: () => false, size: 0 } as ReturnType<typeof nodefs.statSync>);

      await expect(
        tool.execute(makeRequest('fs_read', { path: `${ALLOWED_DIR}/somedir` })),
      ).rejects.toThrow('NOT_A_FILE');
    });

    it('throws FILE_TOO_LARGE when file exceeds 512KB', async () => {
      vi.mocked(nodefs.existsSync).mockReturnValue(true);
      vi.mocked(nodefs.statSync).mockReturnValue({
        isFile: () => true,
        size: 600 * 1024,
      } as ReturnType<typeof nodefs.statSync>);

      await expect(
        tool.execute(makeRequest('fs_read', { path: `${ALLOWED_DIR}/huge.bin` })),
      ).rejects.toThrow('FILE_TOO_LARGE');
    });

    /**
     * BUG-7: fs-read.tool.ts — silent line-range truncation
     *
     * When `endLine` or `startLine` exceeds the actual line count,
     * `Array.slice()` silently returns fewer lines than requested.
     * No error is surfaced to the LLM or the user.
     *
     * Expected: throw `LINE_OUT_OF_RANGE` so the caller knows the range is invalid.
     * Actual before fix: resolves with truncated content and no indication of the problem.
     */
    it('throws LINE_OUT_OF_RANGE when endLine exceeds total line count (BUG-7)', async () => {
      vi.mocked(nodefs.existsSync).mockReturnValue(true);
      vi.mocked(nodefs.statSync).mockReturnValue({ isFile: () => true, size: 50 } as ReturnType<typeof nodefs.statSync>);
      vi.mocked(nodefs.readFileSync).mockReturnValue('line1\nline2'); // 2 lines only

      await expect(
        tool.execute(makeRequest('fs_read', { path: `${ALLOWED_DIR}/f.ts`, startLine: 1, endLine: 999 })),
      ).rejects.toThrow('LINE_OUT_OF_RANGE');
    });

    it('throws LINE_OUT_OF_RANGE when startLine exceeds total line count (BUG-7)', async () => {
      vi.mocked(nodefs.existsSync).mockReturnValue(true);
      vi.mocked(nodefs.statSync).mockReturnValue({ isFile: () => true, size: 50 } as ReturnType<typeof nodefs.statSync>);
      vi.mocked(nodefs.readFileSync).mockReturnValue('line1\nline2'); // 2 lines only

      await expect(
        tool.execute(makeRequest('fs_read', { path: `${ALLOWED_DIR}/f.ts`, startLine: 5 })),
      ).rejects.toThrow('LINE_OUT_OF_RANGE');
    });

    it.each([
      { label: 'startLine is zero', args: { path: `${ALLOWED_DIR}/f.ts`, startLine: 0 } },
      { label: 'startLine is negative', args: { path: `${ALLOWED_DIR}/f.ts`, startLine: -1 } },
      { label: 'endLine is zero', args: { path: `${ALLOWED_DIR}/f.ts`, endLine: 0 } },
      { label: 'endLine is negative', args: { path: `${ALLOWED_DIR}/f.ts`, endLine: -2 } },
      { label: 'startLine is fractional', args: { path: `${ALLOWED_DIR}/f.ts`, startLine: 1.5 } },
      { label: 'endLine is fractional', args: { path: `${ALLOWED_DIR}/f.ts`, endLine: 1.5 } },
    ])('rejects invalid line bounds when $label (REGRESSION)', async ({ args }) => {
      vi.mocked(nodefs.existsSync).mockReturnValue(true);
      vi.mocked(nodefs.statSync).mockReturnValue({ isFile: () => true, size: 50 } as ReturnType<typeof nodefs.statSync>);
      vi.mocked(nodefs.readFileSync).mockReturnValue('line1\nline2\nline3');

      await expect(tool.execute(makeRequest('fs_read', args))).rejects.toThrow('LINE_OUT_OF_RANGE');
    });

    it('rejects a line range when endLine is before startLine (REGRESSION)', async () => {
      vi.mocked(nodefs.existsSync).mockReturnValue(true);
      vi.mocked(nodefs.statSync).mockReturnValue({ isFile: () => true, size: 50 } as ReturnType<typeof nodefs.statSync>);
      vi.mocked(nodefs.readFileSync).mockReturnValue('line1\nline2\nline3');

      await expect(
        tool.execute(makeRequest('fs_read', { path: `${ALLOWED_DIR}/f.ts`, startLine: 3, endLine: 2 })),
      ).rejects.toThrow('LINE_OUT_OF_RANGE');
    });
  });
});

// ── FsListTool ────────────────────────────────────────────────────────────────

describe('FsListTool', () => {
  let tool: FsListTool;
  let allowedPaths: Partial<AllowedPathsService>;

  beforeEach(() => {
    vi.clearAllMocks();
    allowedPaths = {
      isAllowed: vi.fn().mockResolvedValue(true),
    };
    tool = new FsListTool(allowedPaths as AllowedPathsService);
  });

  describe('positive scenarios', () => {
    it('returns entries for a flat directory (non-recursive)', async () => {
      vi.mocked(nodefs.existsSync).mockReturnValue(true);
      // First call: statSync for the dir itself → isDirectory
      // Second call: statSync for 'file.ts' entry → isFile
      // Third call: statSync for 'sub' entry → isDirectory (then depth>maxDepth so no recursion)
      vi.mocked(nodefs.statSync)
        .mockReturnValueOnce({ isDirectory: () => true } as ReturnType<typeof nodefs.statSync>)
        .mockReturnValueOnce({ isDirectory: () => false, isFile: () => true, size: 50 } as ReturnType<typeof nodefs.statSync>)
        .mockReturnValueOnce({ isDirectory: () => true, isFile: () => false, size: 0 } as ReturnType<typeof nodefs.statSync>);

      vi.mocked(nodefs.readdirSync).mockReturnValue(
        ['file.ts', 'sub'] as unknown as ReturnType<typeof nodefs.readdirSync>,
      );

      const result = await tool.execute(makeRequest('fs_list', { path: ALLOWED_DIR }));

      expect(result.path).toBeTruthy();
      expect(result.entries.length).toBeGreaterThan(0);
    });

    it('returns absolute resolved path in result', async () => {
      vi.mocked(nodefs.existsSync).mockReturnValue(true);
      vi.mocked(nodefs.statSync).mockReturnValue({ isDirectory: () => true } as ReturnType<typeof nodefs.statSync>);
      vi.mocked(nodefs.readdirSync).mockReturnValue([] as unknown as ReturnType<typeof nodefs.readdirSync>);

      const result = await tool.execute(makeRequest('fs_list', { path: ALLOWED_DIR }));

      expect(result.path).toBeTruthy();
      expect(typeof result.path).toBe('string');
    });
  });

  describe('edge cases', () => {
    it('returns empty entries for an empty directory', async () => {
      vi.mocked(nodefs.existsSync).mockReturnValue(true);
      vi.mocked(nodefs.statSync).mockReturnValue({ isDirectory: () => true } as ReturnType<typeof nodefs.statSync>);
      vi.mocked(nodefs.readdirSync).mockReturnValue([] as unknown as ReturnType<typeof nodefs.readdirSync>);

      const result = await tool.execute(makeRequest('fs_list', { path: ALLOWED_DIR }));

      expect(result.entries).toHaveLength(0);
    });
  });

  describe('negative scenarios', () => {
    it('throws ACCESS_DENIED for path outside allowed roots', async () => {
      (allowedPaths.isAllowed as ReturnType<typeof vi.fn>).mockResolvedValue(false);

      await expect(
        tool.execute(makeRequest('fs_list', { path: '/secret/dir' })),
      ).rejects.toThrow('ACCESS_DENIED');
    });

    it('throws NOT_FOUND when path does not exist', async () => {
      vi.mocked(nodefs.existsSync).mockReturnValue(false);

      await expect(
        tool.execute(makeRequest('fs_list', { path: `${ALLOWED_DIR}/nope` })),
      ).rejects.toThrow('NOT_FOUND');
    });

    it('throws NOT_A_DIRECTORY when path is a file', async () => {
      vi.mocked(nodefs.existsSync).mockReturnValue(true);
      vi.mocked(nodefs.statSync).mockReturnValue({ isDirectory: () => false } as ReturnType<typeof nodefs.statSync>);

      await expect(
        tool.execute(makeRequest('fs_list', { path: `${ALLOWED_DIR}/file.ts` })),
      ).rejects.toThrow('NOT_A_DIRECTORY');
    });

    it.each([
      { label: 'recursive is string false', recursive: 'false' },
      { label: 'recursive is string true', recursive: 'true' },
      { label: 'recursive is numeric one', recursive: 1 },
      { label: 'recursive is numeric zero', recursive: 0 },
    ])('rejects non-boolean recursive flag when $label (REGRESSION)', async ({ recursive }) => {
      vi.mocked(nodefs.existsSync).mockReturnValue(true);
      vi.mocked(nodefs.statSync).mockReturnValue({ isDirectory: () => true } as ReturnType<typeof nodefs.statSync>);
      vi.mocked(nodefs.readdirSync).mockReturnValue([] as unknown as ReturnType<typeof nodefs.readdirSync>);

      await expect(
        tool.execute(makeRequest('fs_list', { path: ALLOWED_DIR, recursive })),
      ).rejects.toThrow('INVALID_RECURSIVE');
    });
  });
});

// ── FsWriteTool ───────────────────────────────────────────────────────────────

describe('FsWriteTool', () => {
  let tool: FsWriteTool;
  let allowedPaths: Partial<AllowedPathsService>;
  let reflector: Reflector;

  beforeEach(() => {
    vi.clearAllMocks();
    allowedPaths = {
      isAllowed: vi.fn().mockResolvedValue(true),
    };
    tool = new FsWriteTool(allowedPaths as AllowedPathsService);
    reflector = new Reflector();
  });

  describe('@Tool() decorator (REGRESSION)', () => {
    it('MUST have requiresConfirmation=true for filesystem write', () => {
      const metadata = reflector.get(TOOL_METADATA, FsWriteTool);
      expect(metadata.requiresConfirmation).toBe(true);
    });

    it('has correct tool name', () => {
      const metadata = reflector.get(TOOL_METADATA, FsWriteTool);
      expect(metadata.name).toBe('fs_write');
    });
  });

  describe('positive scenarios', () => {
    it('writes file and returns path and bytesWritten', async () => {
      vi.mocked(nodefs.mkdirSync).mockReturnValue(undefined);
      vi.mocked(nodefs.writeFileSync).mockReturnValue(undefined);

      const result = await tool.execute(
        makeRequest('fs_write', { path: `${ALLOWED_DIR}/out.txt`, content: 'Hello' }),
      );

      expect(result.bytesWritten).toBe(5);
      expect(result.path).toBeTruthy();
      expect(nodefs.writeFileSync).toHaveBeenCalled();
    });

    it('auto-creates parent directory via mkdirSync recursive', async () => {
      vi.mocked(nodefs.mkdirSync).mockReturnValue(undefined);
      vi.mocked(nodefs.writeFileSync).mockReturnValue(undefined);

      await tool.execute(
        makeRequest('fs_write', { path: `${ALLOWED_DIR}/deep/new/dir/file.txt`, content: 'x' }),
      );

      expect(nodefs.mkdirSync).toHaveBeenCalledWith(expect.any(String), { recursive: true });
    });

    it('returns correct bytesWritten for multi-byte content', async () => {
      vi.mocked(nodefs.mkdirSync).mockReturnValue(undefined);
      vi.mocked(nodefs.writeFileSync).mockReturnValue(undefined);

      const content = 'abc';
      const result = await tool.execute(
        makeRequest('fs_write', { path: `${ALLOWED_DIR}/out.txt`, content }),
      );

      expect(result.bytesWritten).toBe(Buffer.byteLength(content, 'utf8'));
    });
  });

  describe('negative scenarios', () => {
    it('throws ACCESS_DENIED for path outside allowed roots', async () => {
      (allowedPaths.isAllowed as ReturnType<typeof vi.fn>).mockResolvedValue(false);

      await expect(
        tool.execute(makeRequest('fs_write', { path: '/etc/evil.txt', content: 'pwned' })),
      ).rejects.toThrow('ACCESS_DENIED');
    });

    it('does not call writeFileSync when access is denied', async () => {
      (allowedPaths.isAllowed as ReturnType<typeof vi.fn>).mockResolvedValue(false);

      try {
        await tool.execute(makeRequest('fs_write', { path: '/etc/evil.txt', content: 'x' }));
      } catch {
        // expected
      }

      expect(nodefs.writeFileSync).not.toHaveBeenCalled();
    });

    it.each([
      { label: 'path is empty', path: '' },
      { label: 'path is whitespace', path: '   ' },
    ])('rejects blank target path when $label (REGRESSION)', async ({ path }) => {
      vi.mocked(nodefs.mkdirSync).mockReturnValue(undefined);
      vi.mocked(nodefs.writeFileSync).mockReturnValue(undefined);

      await expect(
        tool.execute(makeRequest('fs_write', { path, content: 'hello' })),
      ).rejects.toThrow('INVALID_PATH');

      expect(nodefs.writeFileSync).not.toHaveBeenCalled();
    });

    it.each([
      { label: 'content is undefined', content: undefined },
      { label: 'content is null', content: null },
      { label: 'content is an object', content: { hello: 'world' } },
      { label: 'content is numeric', content: 123 },
    ])('rejects non-string content when $label (REGRESSION)', async ({ content }) => {
      vi.mocked(nodefs.mkdirSync).mockReturnValue(undefined);
      vi.mocked(nodefs.writeFileSync).mockReturnValue(undefined);

      await expect(
        tool.execute(makeRequest('fs_write', { path: `${ALLOWED_DIR}/out.txt`, content })),
      ).rejects.toThrow('INVALID_CONTENT');

      expect(nodefs.writeFileSync).not.toHaveBeenCalled();
    });
  });
});
