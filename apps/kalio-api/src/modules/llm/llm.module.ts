import { Module } from '@nestjs/common';
import { LLMService } from './llm.service';
import { CredentialsModule } from '../credentials/credentials.module';

@Module({
  imports: [CredentialsModule],
  providers: [LLMService],
  exports: [LLMService],
})
export class LLMModule {}
