import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import { ToolRegistryService } from './tool-registry.service';
import { Reflector } from '@nestjs/core';
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
import { RaAppCreateTool, RaAppCompileTool } from './tools/raapp.tools';
import { MemoryIngestTool, MemorySearchTool, MemoryIngestConversationTool } from './tools/memory.tools';
import { VFSService } from '../vfs/vfs.service';
import { KVStoreService } from './kv-store.service';
import { TerminalService } from './terminal.service';
import { LLMService } from '../llm/llm.service';
import { MemoryService } from '../memory/memory.service';
import { RAAppService } from '../raapp/raapp.service';
import { RAAppSandboxService } from '../raapp/raapp-sandbox.service';
import { ConfigService } from '@nestjs/config';

// AC-11: getToolsForSkills with explicit skill list returns only those tools

describe('ToolRegistryService', () => {
  let service: ToolRegistryService;

  const mockVfs = { writeFile: vi.fn(), readFile: vi.fn(), listFiles: vi.fn() };
  const mockConfig = { get: vi.fn().mockReturnValue('./test-workspace') };
  const mockKV = { get: vi.fn(), set: vi.fn(), list: vi.fn(), delete: vi.fn() };
  const mockTerminal = { spawn: vi.fn(), list: vi.fn(), get: vi.fn(), kill: vi.fn() };
  const mockLLM = { streamChat: vi.fn() };
  const mockMemory = { ingest: vi.fn(), search: vi.fn(), ingestConversation: vi.fn() };
  const mockRaApp = { execute: vi.fn() };
  const mockSandbox = { execute: vi.fn() };

  beforeEach(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        ToolRegistryService,
        Reflector,
        VFSWriteTool, VFSReadTool, VFSListTool, SubagentTool,
        FsReadTool, FsListTool, FsWriteTool,
        KVWriteTool, KVReadTool, KVListTool, KVDeleteTool,
        GrepSearchTool, FileSearchTool,
        TerminalSpawnTool, TerminalListTool, TerminalOutputTool, TerminalKillTool,
        RaAppCreateTool, RaAppCompileTool,
        MemoryIngestTool, MemorySearchTool, MemoryIngestConversationTool,
        { provide: VFSService, useValue: mockVfs },
        { provide: ConfigService, useValue: mockConfig },
        { provide: KVStoreService, useValue: mockKV },
        { provide: TerminalService, useValue: mockTerminal },
        { provide: LLMService, useValue: mockLLM },
        { provide: MemoryService, useValue: mockMemory },
        { provide: RAAppService, useValue: mockRaApp },
        { provide: RAAppSandboxService, useValue: mockSandbox },
      ],
    }).compile();

    service = moduleRef.get<ToolRegistryService>(ToolRegistryService);
  });

  describe('getToolsForSkills', () => {
    it('AC-11: returns ALL tools when skills array is empty (default-on behavior)', () => {
      const result = service.getToolsForSkills([]);

      expect(result.length).toBeGreaterThan(0);
    });

    it('AC-11: returns ALL tools when skills list contains wildcard "*"', () => {
      const result = service.getToolsForSkills(['*']);

      expect(result.length).toBeGreaterThan(0);
    });

    it('AC-11: filters tools by specific skill names', () => {
      const result = service.getToolsForSkills(['vfs_write']);

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('vfs_write');
    });

    it('AC-11: returns empty array when no skills match', () => {
      const result = service.getToolsForSkills(['non_existent_tool']);

      expect(result).toHaveLength(0);
    });

    it('AC-11: only includes tools in the skills list', () => {
      const skills = ['vfs_write', 'kv_read'];
      const result = service.getToolsForSkills(skills);

      expect(result.every((t) => skills.includes(t.name))).toBe(true);
    });
  });

  describe('getMeta', () => {
    it('returns metadata for registered tool', () => {
      const meta = service.getMeta('vfs_write');

      expect(meta).toBeDefined();
      expect(meta?.name).toBe('vfs_write');
      expect(meta?.description).toBeDefined();
      expect(meta?.parameters).toBeDefined();
    });

    it('returns undefined for unknown tool', () => {
      const meta = service.getMeta('unknown_tool');

      expect(meta).toBeUndefined();
    });
  });

  describe('getAllTools', () => {
    it('returns all 22 registered tools', () => {
      const result = service.getAllTools();

      expect(result.length).toBe(22);
    });

    it('includes all expected tool names', () => {
      const names = service.getAllTools().map((t) => t.name);

      const expected = [
        'vfs_write', 'vfs_read', 'vfs_list', 'run_subagent',
        'fs_read', 'fs_list', 'fs_write',
        'kv_write', 'kv_read', 'kv_list', 'kv_delete',
        'grep_search', 'file_search',
        'terminal_spawn', 'terminal_list', 'terminal_output', 'terminal_kill',
        'raapp_create', 'raapp_compile',
        'memory_ingest', 'memory_search', 'memory_ingest_conversation',
      ];

      for (const name of expected) {
        expect(names).toContain(name);
      }
    });
  });
});
