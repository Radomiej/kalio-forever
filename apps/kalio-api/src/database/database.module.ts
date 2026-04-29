import { Global, Module } from '@nestjs/common';
import { DrizzleService } from './drizzle.service';
import { AppSettingsService } from './app-settings.service';

@Global()
@Module({
  providers: [DrizzleService, AppSettingsService],
  exports: [DrizzleService, AppSettingsService],
})
export class DatabaseModule {}
