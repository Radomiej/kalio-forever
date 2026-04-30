import { Module } from '@nestjs/common';
import { MemoryService } from './memory.service';
import { MemoryController } from './memory.controller';
import { CredentialsModule } from '../credentials/credentials.module';

@Module({
  imports: [CredentialsModule],
  controllers: [MemoryController],
  providers: [MemoryService],
  exports: [MemoryService],
})
export class MemoryModule {}
