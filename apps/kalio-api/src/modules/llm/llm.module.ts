import { Module } from '@nestjs/common';
import { LLMService } from './llm.service';
import { LLMController } from './llm.controller';
import { CredentialsModule } from '../credentials/credentials.module';
import { ProviderStreamLimiterService } from './provider-stream-limiter.service';

@Module({
  imports: [CredentialsModule],
  controllers: [LLMController],
  providers: [LLMService, ProviderStreamLimiterService],
  exports: [LLMService],
})
export class LLMModule {}
