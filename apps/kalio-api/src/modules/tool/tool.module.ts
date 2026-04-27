import { Module } from '@nestjs/common';
import { ToolController } from './tool.controller';
import { VFSWriteTool } from './tools/vfs-write.tool';
import { VFSReadTool } from './tools/vfs-read.tool';
import { VFSListTool } from './tools/vfs-list.tool';
import { SubagentTool } from './tools/subagent.tool';
import { FsReadTool } from './tools/fs-read.tool';
import { FsListTool } from './tools/fs-list.tool';
import { FsWriteTool } from './tools/fs-write.tool';
import { KVWriteTool, KVReadTool, KVListTool, KVDeleteTool } from './tools/kv.tools';
import { KVStoreService } from './kv-store.service';
import { GrepSearchTool, FileSearchTool } from './tools/file-search.tools';
import { TerminalService } from './terminal.service';
import { TerminalSpawnTool, TerminalListTool, TerminalOutputTool, TerminalKillTool } from './tools/terminal.tools';
import { RaAppCreateTool, RaAppCompileTool, RunRaAppTool, ListRaAppsTool } from './tools/raapp.tools';
import { MemoryIngestTool, MemorySearchTool, MemoryIngestConversationTool } from './tools/memory.tools';
import { VFSModule } from '../vfs/vfs.module';
import { LLMModule } from '../llm/llm.module';
import { RAAppModule } from '../raapp/raapp.module';
import { MemoryModule } from '../memory/memory.module';
import { AllowedPathsModule } from '../allowed-paths/allowed-paths.module';
import { MCPModule } from '../mcp/mcp.module';
import { ToolRegistryService } from './tool-registry.service';

@Module({
  imports: [VFSModule, LLMModule, RAAppModule, MemoryModule, AllowedPathsModule, MCPModule],
  controllers: [ToolController],
  providers: [
    VFSWriteTool, VFSReadTool, VFSListTool, SubagentTool,
    FsReadTool, FsListTool, FsWriteTool,
    KVStoreService, KVWriteTool, KVReadTool, KVListTool, KVDeleteTool,
    GrepSearchTool, FileSearchTool,
    TerminalService, TerminalSpawnTool, TerminalListTool, TerminalOutputTool, TerminalKillTool,
    RaAppCreateTool, RaAppCompileTool, RunRaAppTool, ListRaAppsTool,
    MemoryIngestTool, MemorySearchTool, MemoryIngestConversationTool,
    ToolRegistryService,
  ],
  exports: [ToolRegistryService],
})
export class ToolModule {}
