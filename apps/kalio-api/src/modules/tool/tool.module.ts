import { Module } from '@nestjs/common';
import { ToolRegistryService } from './tool-registry.service';
import { ToolDispatchService } from './tool-dispatch.service';
import { VFSWriteTool } from './tools/vfs-write.tool';
import { VFSModule } from '../vfs/vfs.module';

@Module({
  imports: [VFSModule],
  providers: [ToolRegistryService, ToolDispatchService, VFSWriteTool],
  exports: [ToolRegistryService, ToolDispatchService],
})
export class ToolModule {}
