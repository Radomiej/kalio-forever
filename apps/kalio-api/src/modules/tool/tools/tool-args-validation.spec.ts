import { describe, it, expect, beforeEach, vi } from 'vitest';
import { VFSReadTool } from './vfs-read.tool';
import { VFSService } from '../../vfs/vfs.service';
import type { ToolCallRequest } from '@kalio/types';

describe('Tool Arguments Validation', () => {
  let tool: VFSReadTool;
  let mockVFSService: VFSService;

  beforeEach(() => {
    mockVFSService = {
      readFile: vi.fn().mockReturnValue({ filePath: 'test.txt', content: 'test content' }),
    } as any;

    tool = new VFSReadTool(mockVFSService);
  });

  describe('VFSReadTool - type coercion bugs BUG CONFIRMED', () => {
    it('should handle missing filePath argument', async () => {
      // Arrange: Tool call without required argument
      const request: ToolCallRequest = {
        toolName: 'vfs_read',
        args: {},
        sessionId: 'test-session',
        callId: 'call-1',
      };

      // Act & Assert - BUG CONFIRMED: No validation, undefined passed to VFS
      const result = await tool.execute(request);
      expect(result).toBeDefined();
      expect(mockVFSService.readFile).toHaveBeenCalledWith('test-session', undefined);
    });

    it('should handle null filePath argument', async () => {
      // Arrange: Tool call with null argument
      const request: ToolCallRequest = {
        toolName: 'vfs_read',
        args: { filePath: null as any },
        sessionId: 'test-session',
        callId: 'call-1',
      };

      // Act & Assert - BUG CONFIRMED: No validation, null passed to VFS
      const result = await tool.execute(request);
      expect(result).toBeDefined();
      expect(mockVFSService.readFile).toHaveBeenCalledWith('test-session', null);
    });

    it('should handle undefined filePath argument', async () => {
      // Arrange: Tool call with undefined argument
      const request: ToolCallRequest = {
        toolName: 'vfs_read',
        args: { filePath: undefined as any },
        sessionId: 'test-session',
        callId: 'call-1',
      };

      // Act & Assert - BUG CONFIRMED: No validation, undefined passed to VFS
      const result = await tool.execute(request);
      expect(result).toBeDefined();
      expect(mockVFSService.readFile).toHaveBeenCalledWith('test-session', undefined);
    });

    it('should handle wrong type for filePath (number)', async () => {
      // Arrange: Tool call with number instead of string
      const request: ToolCallRequest = {
        toolName: 'vfs_read',
        args: { filePath: 123 as any },
        sessionId: 'test-session',
        callId: 'call-1',
      };

      // Act & Assert - BUG CONFIRMED: Type coercion may cause unexpected behavior
      const result = await tool.execute(request);
      expect(result).toBeDefined();
      // The number 123 gets coerced to string "123"
      expect(mockVFSService.readFile).toHaveBeenCalledWith('test-session', 123);
    });

    it('should handle wrong type for filePath (array)', async () => {
      // Arrange: Tool call with array instead of string
      const request: ToolCallRequest = {
        toolName: 'vfs_read',
        args: { filePath: ['file.txt'] as any },
        sessionId: 'test-session',
        callId: 'call-1',
      };

      // Act & Assert - BUG CONFIRMED: Array gets coerced to string
      const result = await tool.execute(request);
      expect(result).toBeDefined();
      expect(mockVFSService.readFile).toHaveBeenCalledWith('test-session', ['file.txt']);
    });

    it('should handle wrong type for filePath (object)', async () => {
      // Arrange: Tool call with object instead of string
      const request: ToolCallRequest = {
        toolName: 'vfs_read',
        args: { filePath: { path: 'file.txt' } as any },
        sessionId: 'test-session',
        callId: 'call-1',
      };

      // Act & Assert - BUG CONFIRMED: Object gets coerced to string "[object Object]"
      const result = await tool.execute(request);
      expect(result).toBeDefined();
      expect(mockVFSService.readFile).toHaveBeenCalledWith('test-session', { path: 'file.txt' });
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
