import { Module } from '@nestjs/common';
import { MemoryService } from './memory.service';
import { MemoryController } from './memory.controller';
import { EmbeddingService } from './embedding.service';
import { EmbeddingModelIdentityService } from './embedding-model-identity.service';
import { EmbeddingCredentialsService } from './embedding-credentials.service';
import { LocalEmbeddingInstallService } from './local-embedding-install.service';
import { AuditModule } from '../chat/audit.module';
import { VFSModule } from '../vfs/vfs.module';
import { ProjectResourceIndexService } from './project-resource-index.service';
import { ProjectResourceIndexController } from './project-resource-index.controller';
import { ProjectResourceAuthGuard } from './project-resource-auth.guard';
import { PROJECT_CONTEXT_PORT } from '@kalio/types';
import { ProjectContextSettingsService } from './project-context-settings.service';
import { ProjectContextSettingsController } from './project-context-settings.controller';
import { ProjectContextSettingsGuard } from './project-context-settings.guard';

@Module({
  imports: [AuditModule, VFSModule],
  controllers: [MemoryController, ProjectResourceIndexController, ProjectContextSettingsController],
  providers: [EmbeddingCredentialsService, EmbeddingModelIdentityService, EmbeddingService, MemoryService, LocalEmbeddingInstallService, ProjectResourceIndexService, ProjectResourceAuthGuard,
    ProjectContextSettingsService, ProjectContextSettingsGuard, { provide: PROJECT_CONTEXT_PORT, useExisting: ProjectResourceIndexService }],
  exports: [MemoryService, EmbeddingCredentialsService, PROJECT_CONTEXT_PORT],
})
export class MemoryModule {}
