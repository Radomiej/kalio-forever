import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { VFSService } from './vfs.service';
import { SessionVfsController } from './session-vfs.controller';
import { PROJECT_RESOURCE_READER, PROJECT_RESOURCE_INDEX_STORAGE } from '@kalio/types';
import { ProjectResourceReaderService } from './project-resource-reader.service';
import { ProjectResourceIndexStorage } from './project-resource-index-storage';

@Module({
  controllers: [SessionVfsController],
  providers: [VFSService, ProjectResourceReaderService, { provide: PROJECT_RESOURCE_READER, useExisting: ProjectResourceReaderService },
    { provide: PROJECT_RESOURCE_INDEX_STORAGE, inject: [ConfigService],
      useFactory: (config: ConfigService) => new ProjectResourceIndexStorage(config.get<string>('MEMORY_DB_PATH', './data/memory')) }],
  exports: [VFSService, PROJECT_RESOURCE_READER, PROJECT_RESOURCE_INDEX_STORAGE],
})
export class VFSModule {}
