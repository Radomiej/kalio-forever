import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import { ToolDispatchService } from './tool-dispatch.service';
import { ToolRegistryService } from './tool-registry.service';
import { VFSWriteTool } from './tools/vfs-write.tool';
import { VFSReadTool } from './tools/vfs-read.tool';
import { VFSListTool } from './tools/vfs-list.tool';
import { SubagentTool } from './tools/subagent.tool';
import { FsReadTool } from './tools/fs-read.tool';
import { FsListTool } from './tools/fs-list.tool';
import { FsWriteTool } from './tools/fs-write.tool';
import { KVWriteTool, KVReadTool, KVListTool, KVDeleteTool } from './tools/kv.tools';
import { GrepSearchTool, FileSearchTool } from './tools/file-search.tools';
import { TerminalSpawnTool, TerminalListTool, TerminalOutputTool, TerminalKillTool } from './tools/terminal.tools';
import { VFSService } from '../vfs/vfs.service';
import { KVStoreService } from './kv-store.service';
import { TerminalService } from './terminal.service';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { LLMService } from '../llm/llm.service';
import { MemoryService } from '../memory/memory.service';
import { RAAppService } from '../raapp/raapp.service';
import { RAAppSandboxService } from '../raapp/raapp-sandbox.service';
import { RaAppCreateTool, RaAppCompileTool } from './tools/raapp.tools';
import { MemoryIngestTool, MemorySearchTool, MemoryIngestConversationTool } from './tools/memory.tools';

// AC-07: Unknown tool name returns TOOL_NOT_FOUND, session does not crash

describe('ToolDispatchService', () => {
  let service: ToolDispatchService;
  let registryService: ToolRegistryService;

  const mockVfsService = {
    writeFile: vi.fn().mockImplementation((req: { filePath: string }) => {
      if (req.filePath.includes('..')) {
        throw new Error(`PATH_TRAVERSAL_DENIED: "${req.filePath}" escapes sandbox`);
      }
    }),
    readFile: vi.fn().mockReturnValue({ sessionId: 'ws', filePath: 'f', content: '' }),
    listFiles: vi.fn().mockReturnValue({ sessionId: 'ws', files: [] }),
  };

  const mockConfigService = { get: vi.fn().mockReturnValue('./test-workspace') };

  beforeEach(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        ToolDispatchService,
        ToolRegistryService,
        Reflector,
        VFSWriteTool, VFSReadTool, VFSListTool, SubagentTool,
        FsReadTool, FsListTool, FsWriteTool,
        KVWriteTool, KVReadTool, KVListTool, KVDeleteTool,
        GrepSearchTool, FileSearchTool,
        TerminalSpawnTool, TerminalListTool, TerminalOutputTool, TerminalKillTool,
        RaAppCreateTool, RaAppCompileTool,
        MemoryIngestTool, MemorySearchTool, MemoryIngestConversationTool,
        { provide: VFSService, useValue: mockVfsService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: KVStoreService, useValue: { get: vi.fn(), set: vi.fn(), list: vi.fn(), delete: vi.fn() } },
        { provide: TerminalService, useValue: { spawn: vi.fn(), list: vi.fn(), get: vi.fn(), kill: vi.fn() } },
        { provide: LLMService, useValue: { streamChat: vi.fn() } },
        { provide: MemoryService, useValue: { ingest: vi.fn(), search: vi.fn(), ingestConversation: vi.fn() } },
        { provide: RAAppService, useValue: { execute: vi.fn().mockResolvedValue({ status: 'ready', renderedContent: '' }) } },
        { provide: RAAppSandboxService, useValue: { execute: vi.fn().mockResolvedValue('') } },
      ],
    }).compile();

    service = moduleRef.get<ToolDispatchService>(ToolDispatchService);
    registryService = moduleRef.get<ToolRegistryService>(ToolRegistryService);
  });

  describe('AC-07 � unknown tool does not crash session', () => {
    it('returns TOOL_NOT_FOUND for unregistered tool name', async () => {
      const result = await service.dispatch({
        sessionId: 'sess-123',
        toolName: 'non_existent_tool',
        args: {},
        callId: 'call-789',
      });

      expect(result.status).toBe('error');
      expect(result.errorCode).toBe('TOOL_NOT_FOUND');
    });

    it('resolves (does not throw) for unknown tool', async () => {
      await expect(
        service.dispatch({
          sessionId: 'sess-123',
            toolName: 'this_does_not_exist',
          args: {},
          callId: 'call-000',
        }),
      ).resolves.toMatchObject({ status: 'error', errorCode: 'TOOL_NOT_FOUND' });
    });
  });

  describe('dispatch � registered tools', () => {
    it('dispatches vfs_write successfully', async () => {
      const result = await service.dispatch({
        sessionId: 'sess-123',
        toolName: 'vfs_write',
        args: { filePath: 'test.txt', content: 'Hello' },
        callId: 'call-789',
      });

      expect(result.status).toBe('success');
      expect(result.callId).toBe('call-789');
    });

    it('handles vfs_write path traversal as TOOL_EXEC_ERROR', async () => {
      const result = await service.dispatch({
        sessionId: 'sess-123',
        toolName: 'vfs_write',
        args: { filePath: '../../../etc/passwd', content: 'malicious' },
        callId: 'call-789',
      });

      expect(result.status).toBe('error');
      expect(result.errorCode).toBeDefined();
    });

    it('all registered tools are dispatchable � no TOOL_NOT_FOUND for any', async () => {
      const allTools = registryService.getAllTools();
      for (const toolMeta of allTools) {
        const result = service.dispatch({
          sessionId: 'sess-123',
            toolName: toolMeta.name,
          args: {},
          callId: 'call-789',
        });
        await expect(result).resolves.not.toMatchObject({ errorCode: 'TOOL_NOT_FOUND' });
      }
    });
  });
});

