import { Module } from '@nestjs/common';
import { ToolController } from './tool.controller';
import { VFSWriteTool } from './tools/vfs-write.tool';
import { VFSReadTool } from './tools/vfs-read.tool';
import { VFSListTool } from './tools/vfs-list.tool';
import { VFSGrepSearchTool, VFSFileSearchTool } from './tools/vfs-search.tools';
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
import { WebSearchTool } from './tools/web-search.tool';
import { ListToolsTool } from './tools/list-tools.tool';
import { GetToolDetailsTool } from './tools/get-tool-details.tool';
import { RunCliAgentTool } from './tools/run-cli-agent.tool';
import { ImageGenerateTool } from './tools/image-generate.tool';
import { ImageEditTool } from './tools/image-edit.tool';
import { ImageViewTool } from './tools/image-view.tool';
import { SkillListTool, SkillReadTool, SkillCreateTool, SkillUpdateTool, SkillDeleteTool } from './tools/skill.tools';
import { PersonaListTool, PersonaCreateTool, PersonaUpdateTool, PersonaDeleteTool } from './tools/persona.tools';
import { VFSModule } from '../vfs/vfs.module';
import { LLMModule } from '../llm/llm.module';
import { RAAppModule } from '../raapp/raapp.module';
import { MemoryModule } from '../memory/memory.module';
import { AllowedPathsModule } from '../allowed-paths/allowed-paths.module';
import { MCPModule } from '../mcp/mcp.module';
import { SearchModule } from '../search/search.module';
import { CLIAgentModule } from '../cli-agent/cli-agent.module';
import { ImageModule } from '../image/image.module';
import { SkillsModule } from '../skills/skills.module';
import { PersonaModule } from '../persona/persona.module';
import { ToolRegistryService } from './tool-registry.service';

@Module({
  imports: [VFSModule, LLMModule, RAAppModule, MemoryModule, AllowedPathsModule, MCPModule, SearchModule, CLIAgentModule, ImageModule, SkillsModule, PersonaModule],
  controllers: [ToolController],
  providers: [
    VFSWriteTool, VFSReadTool, VFSListTool, VFSGrepSearchTool, VFSFileSearchTool, SubagentTool,
    FsReadTool, FsListTool, FsWriteTool,
    KVStoreService, KVWriteTool, KVReadTool, KVListTool, KVDeleteTool,
    GrepSearchTool, FileSearchTool,
    TerminalService, TerminalSpawnTool, TerminalListTool, TerminalOutputTool, TerminalKillTool,
    RaAppCreateTool, RaAppCompileTool, RunRaAppTool, ListRaAppsTool,
    MemoryIngestTool, MemorySearchTool, MemoryIngestConversationTool,
    WebSearchTool,
    ListToolsTool, GetToolDetailsTool,
    RunCliAgentTool,
    ImageGenerateTool, ImageEditTool, ImageViewTool,
    SkillListTool, SkillReadTool, SkillCreateTool, SkillUpdateTool, SkillDeleteTool,
    PersonaListTool, PersonaCreateTool, PersonaUpdateTool, PersonaDeleteTool,
    ToolRegistryService,
  ],
  exports: [ToolRegistryService],
})
export class ToolModule {}
