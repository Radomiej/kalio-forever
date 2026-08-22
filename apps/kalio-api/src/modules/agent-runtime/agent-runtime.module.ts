import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { ExecutionProfileController } from './execution-profile.controller';
import { ExecutionProfileService } from './execution-profile.service';
import { CodexAppServerHost } from './codex-app-server.host';
import { CodexAppServerLLMSource } from './codex-app-server.llm-source';
import { NativeApprovalService } from './native-approval.service';
import { NativeCliIntegrationController } from './native-cli-integration.controller';
import { CodexMcpPolicyService } from './codex-mcp-policy.service';

@Module({
  imports: [DatabaseModule],
  controllers: [ExecutionProfileController, NativeCliIntegrationController],
  providers: [ExecutionProfileService, CodexAppServerHost, CodexAppServerLLMSource, NativeApprovalService, CodexMcpPolicyService],
  exports: [ExecutionProfileService, CodexAppServerHost, CodexAppServerLLMSource, NativeApprovalService, CodexMcpPolicyService],
})
export class AgentRuntimeModule {}
