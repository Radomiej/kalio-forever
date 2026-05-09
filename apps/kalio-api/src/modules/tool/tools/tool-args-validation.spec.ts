import { describe, it, expect, beforeEach, vi } from 'vitest';
import { VFSReadTool } from './vfs-read.tool';
import { VFSService } from '../../vfs/vfs.service';
import type { ToolCallRequest } from '@kalio/types';

describe('Tool Arguments Validation', () => {
  let tool: VFSReadTool;
  let mockVFSService: Pick<VFSService, 'readFile'>;

  beforeEach(() => {
    mockVFSService = {
      readFile: vi.fn().mockReturnValue({ filePath: 'test.txt', content: 'test content' }),
    };

    tool = new VFSReadTool(mockVFSService as VFSService);
  });

  describe('VFSReadTool - runtime validation (REGRESSION)', () => {
    it.each([
      { label: 'missing filePath argument', args: {} },
      { label: 'null filePath argument', args: { filePath: null } },
      { label: 'undefined filePath argument', args: { filePath: undefined } },
      { label: 'empty filePath argument', args: { filePath: '' } },
      { label: 'whitespace filePath argument', args: { filePath: '   ' } },
      { label: 'numeric filePath argument', args: { filePath: 123 } },
      { label: 'array filePath argument', args: { filePath: ['file.txt'] } },
      { label: 'object filePath argument', args: { filePath: { path: 'file.txt' } } },
    ])('rejects $label', async ({ args }) => {
      const request: ToolCallRequest = {
        toolName: 'vfs_read',
        args,
        sessionId: 'test-session',
        callId: 'call-1',
      };

      await expect(tool.execute(request)).rejects.toThrow('INVALID_FILE_PATH');
      expect(mockVFSService.readFile).not.toHaveBeenCalled();
    });
  });

  describe('ToolCallRequest - missing fields', () => {
    it('should handle missing sessionId', async () => {
      // Arrange: Tool call without sessionId
      const request: ToolCallRequest = {
        toolName: 'vfs_read',
        args: { filePath: 'test.txt' },
        sessionId: '' as any, // Empty or invalid
        callId: 'call-1',
      };

      // Act & Assert - Should handle gracefully
      const result = await tool.execute(request);
      expect(result).toBeDefined();
    });

    it('should handle missing callId', async () => {
      // Arrange: Tool call without callId
      const request: ToolCallRequest = {
        toolName: 'vfs_read',
        args: { filePath: 'test.txt' },
        sessionId: 'test-session',
        callId: '' as any, // Empty or invalid
      };

      // Act & Assert - Should handle gracefully
      const result = await tool.execute(request);
      expect(result).toBeDefined();
    });
  });
});
