import { Module } from '@nestjs/common';
import { MemoryService } from './memory.service';
import { MemoryController } from './memory.controller';
import { EmbeddingService } from './embedding.service';
import { EmbeddingCredentialsService } from './embedding-credentials.service';

@Module({
  controllers: [MemoryController],
  providers: [EmbeddingCredentialsService, EmbeddingService, MemoryService],
  exports: [MemoryService, EmbeddingCredentialsService],
})
export class MemoryModule {}
