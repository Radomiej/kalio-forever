import { Module } from '@nestjs/common';
import { MemoryService } from './memory.service';
import { MemoryController } from './memory.controller';
import { EmbeddingService } from './embedding.service';
import { EmbeddingCredentialsService } from './embedding-credentials.service';
import { LocalEmbeddingInstallService } from './local-embedding-install.service';
import { AuditModule } from '../chat/audit.module';

@Module({
  imports: [AuditModule],
  controllers: [MemoryController],
  providers: [EmbeddingCredentialsService, EmbeddingService, MemoryService, LocalEmbeddingInstallService],
  exports: [MemoryService, EmbeddingCredentialsService],
})
export class MemoryModule {}
