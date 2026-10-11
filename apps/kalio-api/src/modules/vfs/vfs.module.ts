import { Module } from '@nestjs/common';
import { VFSService } from './vfs.service';
import { SessionVfsController } from './session-vfs.controller';
import { PROJECT_RESOURCE_READER } from '@kalio/types';
import { ProjectResourceReaderService } from './project-resource-reader.service';

@Module({
  controllers: [SessionVfsController],
  providers: [VFSService, ProjectResourceReaderService, { provide: PROJECT_RESOURCE_READER, useExisting: ProjectResourceReaderService }],
  exports: [VFSService, PROJECT_RESOURCE_READER],
})
export class VFSModule {}
