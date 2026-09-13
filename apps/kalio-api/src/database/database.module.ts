import { Global, Module } from '@nestjs/common';
import { DrizzleService } from './drizzle.service';
import { AppSettingsService } from './app-settings.service';
import { KalioMcpBridgeTokenService } from './kalio-mcp-bridge-token.service';

@Global()
@Module({
  providers: [DrizzleService, AppSettingsService, KalioMcpBridgeTokenService],
  exports: [DrizzleService, AppSettingsService, KalioMcpBridgeTokenService],
})
export class DatabaseModule {}
