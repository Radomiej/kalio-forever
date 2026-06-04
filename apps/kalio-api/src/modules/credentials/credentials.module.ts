import { forwardRef, Module } from '@nestjs/common';
import { CredentialsController } from './credentials.controller';
import { CredentialsService } from './credentials.service';
import { TimeoutSettingsService } from './timeout-settings.service';
import { LLMModule } from '../llm/llm.module';

@Module({
  imports: [forwardRef(() => LLMModule)],
  controllers: [CredentialsController],
  providers: [CredentialsService, TimeoutSettingsService],
  exports: [CredentialsService, TimeoutSettingsService],
})
export class CredentialsModule {}
