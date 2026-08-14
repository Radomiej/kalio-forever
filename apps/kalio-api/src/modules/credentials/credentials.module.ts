import { Module } from '@nestjs/common';
import { CredentialsController } from './credentials.controller';
import { CredentialsService } from './credentials.service';
import { TimeoutSettingsService } from './timeout-settings.service';

@Module({
  controllers: [CredentialsController],
  providers: [CredentialsService, TimeoutSettingsService],
  exports: [CredentialsService, TimeoutSettingsService],
})
export class CredentialsModule {}
