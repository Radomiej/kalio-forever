import { Module } from '@nestjs/common';
import { ToolRegistryService } from './tool-registry.service';
import { ToolDispatchService } from './tool-dispatch.service';
import { ToolController } from './tool.controller';
import { VFSWriteTool } from './tools/vfs-write.tool';
import { VFSReadTool } from './tools/vfs-read.tool';
import { VFSListTool } from './tools/vfs-list.tool';
import { SubagentTool } from './tools/subagent.tool';
import { VFSModule } from '../vfs/vfs.module';
import { LLMModule } from '../llm/llm.module';

@Module({
  imports: [VFSModule, LLMModule],
  controllers: [ToolController],
  providers: [ToolRegistryService, ToolDispatchService, VFSWriteTool, VFSReadTool, VFSListTool, SubagentTool],
  exports: [ToolRegistryService, ToolDispatchService],
})
export class ToolModule {}
