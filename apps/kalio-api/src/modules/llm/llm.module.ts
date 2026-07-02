import { Module } from '@nestjs/common';
import { LLMService } from './llm.service';
import { LLMController } from './llm.controller';
import { CredentialsModule } from '../credentials/credentials.module';
import { ProviderStreamLimiterService } from './provider-stream-limiter.service';
import { CredentialsRuntimeController } from './credentials-runtime.controller';

@Module({
  imports: [CredentialsModule],
  controllers: [LLMController, CredentialsRuntimeController],
  providers: [LLMService, ProviderStreamLimiterService],
  exports: [LLMService],
})
export class LLMModule {}
