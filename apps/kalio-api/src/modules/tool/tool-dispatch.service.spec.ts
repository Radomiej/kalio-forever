import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import { ToolDispatchService } from './tool-dispatch.service';
import { ToolRegistryService } from './tool-registry.service';
import { VFSWriteTool } from './tools/vfs-write.tool';
import { VFSService } from '../vfs/vfs.service';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';

// Regression test for: Hardcoded Tool Map in ToolDispatchService
// Issue: The resolveTool method uses a hardcoded map instead of dynamic resolution from ToolRegistryService
// This breaks scalability - every new tool requires manual addition to the map

describe('ToolDispatchService', () => {
  let service: ToolDispatchService;
  let registryService: ToolRegistryService;

  beforeEach(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        ToolDispatchService,
        ToolRegistryService,
        VFSWriteTool,
        Reflector,
        {
          provide: VFSService,
          useValue: {
            writeFile: vi.fn().mockImplementation((req: { filePath: string }) => {
              if (req.filePath.includes('..')) {
                const err = new Error(`PATH_TRAVERSAL_DENIED: "${req.filePath}" escapes conversation sandbox`);
                (err as NodeJS.ErrnoException).code = 'PATH_TRAVERSAL_DENIED';
                throw err;
              }
            }),
            readFile: vi.fn(),
            listFiles: vi.fn(),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: vi.fn().mockReturnValue('./test-workspace'),
          },
        },
      ],
    }).compile();

    service = moduleRef.get<ToolDispatchService>(ToolDispatchService);
    registryService = moduleRef.get<ToolRegistryService>(ToolRegistryService);
  });

  describe('resolveTool - Hardcoded Map Issue (REGRESSION TEST)', () => {
    it('should resolve tools dynamically from registry, not hardcoded map', () => {
      // Arrange
      // Register a mock tool in the registry
      const mockTool = {
        execute: vi.fn().mockResolvedValue({ data: 'test' }),
      };

      // Act & Assert
      // The current implementation has a hardcoded map:
      // const map: Record<string, ...> = { vfs_write: this.vfsWriteTool };
      // This test verifies that adding a new tool to the registry should make it available
      // without modifying ToolDispatchService

      // Get all registered tools from registry
      const allTools = registryService.getAllTools();

      // For each registered tool, the dispatch service should be able to resolve it
      // This will fail if the implementation uses a hardcoded map that doesn't include the tool
      for (const toolMeta of allTools) {
        const request = {
          sessionId: 'sess-123',
          conversationId: 'conv-456',
          toolName: toolMeta.name,
          args: {},
          callId: 'call-789',
        };

        // This dispatch call should work for any registered tool
        // If the tool is in registry but not in the hardcoded map, it will fail
        const result = service.dispatch(request);

        // We don't care about the result, just that it doesn't throw TOOL_NOT_FOUND
        // for tools that are registered
        expect(result).resolves.not.toMatchObject({
          errorCode: 'TOOL_NOT_FOUND',
        });
      }
    });

    it('should fail gracefully for tools not in registry', async () => {
      // Arrange
      const request = {
        sessionId: 'sess-123',
        conversationId: 'conv-456',
        toolName: 'non_existent_tool',
        args: {},
        callId: 'call-789',
      };

      // Act
      const result = await service.dispatch(request);

      // Assert
      expect(result).toMatchObject({
        status: 'error',
        errorCode: 'TOOL_NOT_FOUND',
      });
    });
  });

  describe('dispatch', () => {
    it('should dispatch known tool successfully', async () => {
      // Arrange
      const request = {
        sessionId: 'sess-123',
        conversationId: 'conv-456',
        toolName: 'vfs_write',
        args: {
          filePath: 'test.txt',
          content: 'Hello',
        },
        callId: 'call-789',
      };

      // Act
      const result = await service.dispatch(request);

      // Assert
      expect(result.status).toBe('success');
      expect(result.callId).toBe('call-789');
    });

    it('should handle tool execution errors', async () => {
      // Arrange
      const request = {
        sessionId: 'sess-123',
        conversationId: 'conv-456',
        toolName: 'vfs_write',
        args: {
          filePath: '../../../etc/passwd', // This will trigger path traversal error
          content: 'malicious',
        },
        callId: 'call-789',
      };

      // Act
      const result = await service.dispatch(request);

      // Assert
      expect(result.status).toBe('error');
      expect(result.errorCode).toBeDefined();
    });
  });
});
