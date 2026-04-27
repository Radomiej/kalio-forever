import { Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { ToolMeta, ToolCallRequest } from '@kalio/types';
import { TOOL_METADATA, type ToolOptions } from '../../common/decorators/tool.decorator';
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
import { RaAppCreateTool, RaAppCompileTool, RunRaAppTool, ListRaAppsTool } from './tools/raapp.tools';
import { MemoryIngestTool, MemorySearchTool, MemoryIngestConversationTool } from './tools/memory.tools';

/** Minimal registry entry shape — structurally compatible with chat module's ToolRegistryEntry. */
export interface ToolEntry {
  meta: ToolMeta;
  execute(req: ToolCallRequest): Promise<unknown>;
}

type HasExecute = { execute(req: ToolCallRequest): Promise<unknown> };

/**
 * Reads @Tool() metadata off every tool class and exposes a typed registry
 * that ChatModule can consume via DI without direct cross-module imports.
 */
@Injectable()
export class ToolRegistryService {
  private readonly entries: ToolEntry[];

  constructor(
    private readonly reflector: Reflector,
    private readonly vfsWrite: VFSWriteTool,
    private readonly vfsRead: VFSReadTool,
    private readonly vfsList: VFSListTool,
    private readonly subagent: SubagentTool,
    private readonly fsRead: FsReadTool,
    private readonly fsList: FsListTool,
    private readonly fsWrite: FsWriteTool,
    private readonly kvWrite: KVWriteTool,
    private readonly kvRead: KVReadTool,
    private readonly kvList: KVListTool,
    private readonly kvDelete: KVDeleteTool,
    private readonly grepSearch: GrepSearchTool,
    private readonly fileSearch: FileSearchTool,
    private readonly terminalSpawn: TerminalSpawnTool,
    private readonly terminalList: TerminalListTool,
    private readonly terminalOutput: TerminalOutputTool,
    private readonly terminalKill: TerminalKillTool,
    private readonly raappCreate: RaAppCreateTool,
    private readonly raappCompile: RaAppCompileTool,
    private readonly runRaApp: RunRaAppTool,
    private readonly listRaApps: ListRaAppsTool,
    private readonly memoryIngest: MemoryIngestTool,
    private readonly memorySearch: MemorySearchTool,
    private readonly memoryIngestConversation: MemoryIngestConversationTool,
  ) {
    const all: object[] = [
      vfsWrite, vfsRead, vfsList, subagent,
      fsRead, fsList, fsWrite,
      kvWrite, kvRead, kvList, kvDelete,
      grepSearch, fileSearch,
      terminalSpawn, terminalList, terminalOutput, terminalKill,
      raappCreate, raappCompile, runRaApp, listRaApps,
      memoryIngest, memorySearch, memoryIngestConversation,
    ];
    this.entries = all.map(t => this.toEntry(t));
  }

  getEntries(): ToolEntry[] {
    return this.entries;
  }

  private toEntry(tool: object): ToolEntry {
    const opts = this.reflector.get<ToolOptions>(TOOL_METADATA, tool.constructor as NewableFunction);
    return {
      meta: {
        name: opts.name,
        description: opts.description,
        parameters: opts.parameters,
        requiresConfirmation: opts.requiresConfirmation ?? false,
      },
      execute: (req: ToolCallRequest) => (tool as HasExecute).execute(req),
    };
  }
}
