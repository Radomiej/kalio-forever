import { Global, Module } from '@nestjs/common';
import { DrizzleService } from './drizzle.service';
import { AppSettingsService } from './app-settings.service';
import { KalioMcpBridgeTokenService } from './kalio-mcp-bridge-token.service';
import { TOOL_APPROVAL_CONTEXT } from '../common/tool-approval-context.port';
import { ToolApprovalContextService } from './tool-approval-context.service';

@Global()
@Module({
  providers: [DrizzleService, AppSettingsService, KalioMcpBridgeTokenService, ToolApprovalContextService,
    { provide: TOOL_APPROVAL_CONTEXT, useExisting: ToolApprovalContextService }],
  exports: [DrizzleService, AppSettingsService, KalioMcpBridgeTokenService, TOOL_APPROVAL_CONTEXT],
})
export class DatabaseModule {}
