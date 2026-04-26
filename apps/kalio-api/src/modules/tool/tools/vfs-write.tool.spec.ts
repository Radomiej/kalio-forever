import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import { VFSWriteTool } from './vfs-write.tool';
import { VFSService } from '../../vfs/vfs.service';
import { Reflector } from '@nestjs/core';
import { TOOL_METADATA } from '../../../common/decorators/tool.decorator';

// Regression test for: VFS Write Tool Missing Required HITL Confirmation
// Per AGENTS.md: "All tools that write, delete, or execute system commands MUST have requiresConfirmation: true"

describe('VFSWriteTool', () => {
  let tool: VFSWriteTool;
  let vfsService: VFSService;
  let reflector: Reflector;

  beforeEach(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        VFSWriteTool,
        {
          provide: VFSService,
          useValue: {
            writeFile: vi.fn(),
          },
        },
        Reflector,
      ],
    }).compile();

    tool = moduleRef.get<VFSWriteTool>(VFSWriteTool);
    vfsService = moduleRef.get<VFSService>(VFSService);
    reflector = moduleRef.get<Reflector>(Reflector);
  });

  describe('@Tool() decorator metadata (REGRESSION TEST)', () => {
    it('MUST have requiresConfirmation set to true for file write operations', () => {
      // Arrange
      const metadata = reflector.get(TOOL_METADATA, VFSWriteTool);

      // Act & Assert
      // This is a CRITICAL security requirement per AGENTS.md:
      // "All tools that write, delete, or execute system commands MUST have requiresConfirmation: true"
      expect(metadata).toBeDefined();
      expect(metadata.requiresConfirmation).toBe(true);
    });

    it('should have correct tool name', () => {
      const metadata = reflector.get(TOOL_METADATA, VFSWriteTool);

      expect(metadata.name).toBe('vfs_write');
    });

    it('should have required parameters defined', () => {
      const metadata = reflector.get(TOOL_METADATA, VFSWriteTool);

      expect(metadata.parameters).toBeDefined();
      expect(metadata.parameters.type).toBe('object');
      expect(metadata.parameters.required).toContain('filePath');
      expect(metadata.parameters.required).toContain('content');
    });
  });

  describe('execute', () => {
    it('should call vfs.writeFile with correct arguments', async () => {
      // Arrange
      const mockWriteFile = vi.spyOn(vfsService, 'writeFile').mockResolvedValue(undefined);
      const request = {
        sessionId: 'sess-123',
        toolName: 'vfs_write',
        args: {
          filePath: 'test.txt',
          content: 'Hello World',
        },
        callId: 'call-789',
      };

      // Act
      const result = await tool.execute(request);

      // Assert
      expect(mockWriteFile).toHaveBeenCalledWith({
        sessionId: 'sess-123',
        filePath: 'test.txt',
        content: 'Hello World',
      });
      expect(result).toEqual({
        path: 'test.txt',
        bytesWritten: Buffer.byteLength('Hello World', 'utf8'),
      });
    });

    it('should propagate errors from vfs.writeFile', async () => {
      // Arrange
      const error = new Error('Disk full');
      error.name = 'ENOSPC';
      vi.spyOn(vfsService, 'writeFile').mockImplementation(() => {
        throw error;
      });

      const request = {
        sessionId: 'sess-123',
        toolName: 'vfs_write',
        args: {
          filePath: 'test.txt',
          content: 'content',
        },
        callId: 'call-789',
      };

      // Act & Assert
      await expect(tool.execute(request)).rejects.toThrow('Disk full');
    });
  });
});


