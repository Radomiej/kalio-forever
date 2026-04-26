import { Injectable, Logger, forwardRef, Inject } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { ToolMeta } from '@kalio/types';
import { TOOL_METADATA } from '../../common/decorators/tool.decorator';
import { VFSWriteTool } from './tools/vfs-write.tool';
import { VFSReadTool } from './tools/vfs-read.tool';
import { VFSListTool } from './tools/vfs-list.tool';
import { FsReadTool } from './tools/fs-read.tool';
import { FsListTool } from './tools/fs-list.tool';
import { FsWriteTool } from './tools/fs-write.tool';
import { KVWriteTool, KVReadTool, KVListTool, KVDeleteTool } from './tools/kv.tools';
import { GrepSearchTool, FileSearchTool } from './tools/file-search.tools';
import { TerminalSpawnTool, TerminalListTool, TerminalOutputTool, TerminalKillTool } from './tools/terminal.tools';
import { RaAppCreateTool, RaAppCompileTool, RunRaAppTool, ListRaAppsTool } from './tools/raapp.tools';
import { MemoryIngestTool, MemorySearchTool, MemoryIngestConversationTool } from './tools/memory.tools';
import { MCPService } from '../mcp/mcp.service';

@Injectable()
export class ToolRegistryService {
  private readonly logger = new Logger(ToolRegistryService.name);
  private readonly registry = new Map<string, ToolMeta>();

  constructor(
    private readonly reflector: Reflector,
    private readonly mcpService: MCPService,
    private readonly vfsWriteTool: VFSWriteTool,
    private readonly vfsReadTool: VFSReadTool,
    private readonly vfsListTool: VFSListTool,
    private readonly fsReadTool: FsReadTool,
    private readonly fsListTool: FsListTool,
    private readonly fsWriteTool: FsWriteTool,
    private readonly kvWriteTool: KVWriteTool,
    private readonly kvReadTool: KVReadTool,
    private readonly kvListTool: KVListTool,
    private readonly kvDeleteTool: KVDeleteTool,
    private readonly grepSearchTool: GrepSearchTool,
    private readonly fileSearchTool: FileSearchTool,
    private readonly terminalSpawnTool: TerminalSpawnTool,
    private readonly terminalListTool: TerminalListTool,
    private readonly terminalOutputTool: TerminalOutputTool,
    private readonly terminalKillTool: TerminalKillTool,
    private readonly raAppCreateTool: RaAppCreateTool,
    private readonly raAppCompileTool: RaAppCompileTool,
    private readonly runRaAppTool: RunRaAppTool,
    private readonly listRaAppsTool: ListRaAppsTool,
    private readonly memoryIngestTool: MemoryIngestTool,
    private readonly memorySearchTool: MemorySearchTool,
    private readonly memoryIngestConversationTool: MemoryIngestConversationTool,
  ) {
    this.registerAll([
      vfsWriteTool, vfsReadTool, vfsListTool,
      fsReadTool, fsListTool, fsWriteTool,
      kvWriteTool, kvReadTool, kvListTool, kvDeleteTool,
      grepSearchTool, fileSearchTool,
      terminalSpawnTool, terminalListTool, terminalOutputTool, terminalKillTool,
      raAppCreateTool, raAppCompileTool, runRaAppTool, listRaAppsTool,
      memoryIngestTool, memorySearchTool, memoryIngestConversationTool,
    ]);
  }

  registerSubagentTool(subagentTool: any): void {
    this.registerAll([subagentTool]);
  }

  private registerAll(tools: object[]): void {
    for (const tool of tools) {
      const meta = this.reflector.get<ToolMeta>(TOOL_METADATA, tool.constructor);
      if (meta) {
        this.registry.set(meta.name, meta);
        this.logger.log(`Registered tool: ${meta.name}`);
      }
    }
  }

  getMeta(name: string): ToolMeta | undefined {
    const nativeMeta = this.registry.get(name);
    if (nativeMeta) return nativeMeta;

    // Check MCP tools
    const mcpTools = this.mcpService.getAllTools();
    const mcpTool = mcpTools.find((t) => t.name === name);
    if (mcpTool) {
      return {
        name: mcpTool.name,
        description: mcpTool.description,
        parameters: mcpTool.parameters as Record<string, unknown>,
        requiresConfirmation: mcpTool.requiresConfirmation,
      };
    }

    return undefined;
  }

  getAllTools(): ToolMeta[] {
    const nativeTools = Array.from(this.registry.values());
    const mcpTools = this.mcpService.getAllTools().map((mcpTool) => ({
      name: mcpTool.name,
      description: mcpTool.description,
      parameters: mcpTool.parameters as Record<string, unknown>,
      requiresConfirmation: mcpTool.requiresConfirmation,
    }));
    return [...nativeTools, ...mcpTools];
  }

  getToolsForSkills(skills: string[]): ToolMeta[] {
    // Empty skills list = all registered tools available (default-on behavior)
    if (skills.length === 0) return this.getAllTools();
    if (skills.includes('*')) return this.getAllTools();
    return this.getAllTools().filter((t) => skills.includes(t.name));
  }
}
