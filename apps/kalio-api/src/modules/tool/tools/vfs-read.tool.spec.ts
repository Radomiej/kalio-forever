import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VFSReadTool } from './vfs-read.tool';
import { VFSListTool } from './vfs-list.tool';
import type { VFSService } from '../../vfs/vfs.service';
import type { ToolCallRequest } from '@kalio/types';

function makeRequest(toolName: string, args: Record<string, unknown> = {}, sessionId = 'sess-abc'): ToolCallRequest {
  return { callId: 'call-1', sessionId, toolName, args };
}

// ── VFSReadTool ───────────────────────────────────────────────────────────────

describe('VFSReadTool', () => {
  let tool: VFSReadTool;
  let vfs: Partial<VFSService>;

  beforeEach(() => {
    vfs = {
      readFile: vi.fn(),
    };
    tool = new VFSReadTool(vfs as VFSService);
  });

  describe('positive scenarios', () => {
    it('returns filePath and content for an existing file', async () => {
      (vfs.readFile as ReturnType<typeof vi.fn>).mockReturnValue({
        sessionId: 'sess-abc',
        filePath: 'notes.txt',
        content: 'Hello World',
      });

      const result = await tool.execute(makeRequest('vfs_read', { filePath: 'notes.txt' }));

      expect(result.filePath).toBe('notes.txt');
      expect(result.content).toBe('Hello World');
    });

    it('passes sessionId and filePath to VFSService.readFile', async () => {
      (vfs.readFile as ReturnType<typeof vi.fn>).mockReturnValue({
        sessionId: 'sess-abc',
        filePath: 'subdir/file.json',
        content: '{}',
      });

      await tool.execute(makeRequest('vfs_read', { filePath: 'subdir/file.json' }, 'sess-abc'));

      expect(vfs.readFile).toHaveBeenCalledWith('sess-abc', 'subdir/file.json');
    });
  });

  describe('edge cases', () => {
    it('handles file with multi-line content', async () => {
      const content = 'line1\nline2\nline3';
      (vfs.readFile as ReturnType<typeof vi.fn>).mockReturnValue({
        sessionId: 'sess-abc',
        filePath: 'multi.txt',
        content,
      });

      const result = await tool.execute(makeRequest('vfs_read', { filePath: 'multi.txt' }));

      expect(result.content).toBe(content);
    });

    it('handles empty file content', async () => {
      (vfs.readFile as ReturnType<typeof vi.fn>).mockReturnValue({
        sessionId: 'sess-abc',
        filePath: 'empty.txt',
        content: '',
      });

      const result = await tool.execute(makeRequest('vfs_read', { filePath: 'empty.txt' }));

      expect(result.content).toBe('');
    });
  });

  describe('negative scenarios', () => {
    it('propagates error when VFSService.readFile throws (file not found)', async () => {
      (vfs.readFile as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error('ENOENT: no such file');
      });

      await expect(tool.execute(makeRequest('vfs_read', { filePath: 'missing.txt' }))).rejects.toThrow(
        'ENOENT: no such file',
      );
    });

    it('propagates path traversal error from VFSService', async () => {
      (vfs.readFile as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error('PATH_TRAVERSAL_DENIED');
      });

      await expect(tool.execute(makeRequest('vfs_read', { filePath: '../../../etc/passwd' }))).rejects.toThrow(
        'PATH_TRAVERSAL_DENIED',
      );
    });
  });
});

// ── VFSListTool ───────────────────────────────────────────────────────────────

describe('VFSListTool', () => {
  let tool: VFSListTool;
  let vfs: Partial<VFSService>;

  beforeEach(() => {
    vfs = {
      listFiles: vi.fn(),
    };
    tool = new VFSListTool(vfs as VFSService);
  });

  describe('positive scenarios', () => {
    it('returns sessionId and files list', async () => {
      (vfs.listFiles as ReturnType<typeof vi.fn>).mockReturnValue({
        sessionId: 'sess-abc',
        files: [
          { path: 'notes.txt', sizeBytes: 100, sessionId: 'sess-abc' },
          { path: 'data.json', sizeBytes: 200, sessionId: 'sess-abc' },
        ],
      });

      const result = await tool.execute(makeRequest('vfs_list'));

      expect(result.sessionId).toBe('sess-abc');
      expect(result.files).toHaveLength(2);
      expect(result.files[0]).toEqual({ path: 'notes.txt', sizeBytes: 100 });
      expect(result.files[1]).toEqual({ path: 'data.json', sizeBytes: 200 });
    });

    it('passes sessionId to VFSService.listFiles', async () => {
      (vfs.listFiles as ReturnType<typeof vi.fn>).mockReturnValue({
        sessionId: 'sess-xyz',
        files: [],
      });

      await tool.execute(makeRequest('vfs_list', {}, 'sess-xyz'));

      expect(vfs.listFiles).toHaveBeenCalledWith('sess-xyz');
    });
  });

  describe('edge cases', () => {
    it('returns empty files array when session has no files', async () => {
      (vfs.listFiles as ReturnType<typeof vi.fn>).mockReturnValue({
        sessionId: 'sess-abc',
        files: [],
      });

      const result = await tool.execute(makeRequest('vfs_list'));

      expect(result.files).toHaveLength(0);
    });

    it('only exposes path and sizeBytes (strips extra VFSFile fields)', async () => {
      (vfs.listFiles as ReturnType<typeof vi.fn>).mockReturnValue({
        sessionId: 'sess-abc',
        files: [{ path: 'file.txt', sizeBytes: 42, sessionId: 'sess-abc', extra: 'should-not-appear' }],
      });

      const result = await tool.execute(makeRequest('vfs_list'));

      const file = result.files[0];
      expect(Object.keys(file)).toStrictEqual(['path', 'sizeBytes']);
    });
  });

  describe('negative scenarios', () => {
    it('propagates error when VFSService.listFiles throws', async () => {
      (vfs.listFiles as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error('VFS_IO_ERROR');
      });

      await expect(tool.execute(makeRequest('vfs_list'))).rejects.toThrow('VFS_IO_ERROR');
    });
  });
});
