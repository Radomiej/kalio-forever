import { Module } from '@nestjs/common';
import { MemoryService } from './memory.service';
import { MemoryController } from './memory.controller';
import { EmbeddingService } from './embedding.service';
import { EmbeddingCredentialsService } from './embedding-credentials.service';
import { LocalEmbeddingInstallService } from './local-embedding-install.service';
import { AuditService } from '../chat/audit.service';

@Module({
  controllers: [MemoryController],
  providers: [EmbeddingCredentialsService, EmbeddingService, MemoryService, LocalEmbeddingInstallService, AuditService],
  exports: [MemoryService, EmbeddingCredentialsService],
})
export class MemoryModule {}
