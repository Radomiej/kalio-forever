import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { CLIAgentModule } from '../cli-agent/cli-agent.module';
import { CredentialsModule } from '../credentials/credentials.module';
import { ExecutionProfileController } from './execution-profile.controller';
import { ExecutionProfileService } from './execution-profile.service';
import { CodexAppServerHost } from './codex-app-server.host';
import { CodexAppServerLLMSource } from './codex-app-server.llm-source';
import { ClaudeAgentSdkLLMSource } from './claude-agent-sdk.llm-source';
import { DevinApiClient } from './devin-api.client';
import { DevinApiLLMSource } from './devin-api.llm-source';
import { DevinIntegrationController } from './devin-integration.controller';
import { NativeApprovalService } from './native-approval.service';
import { NativeCliIntegrationController } from './native-cli-integration.controller';
import { CodexMcpPolicyService } from './codex-mcp-policy.service';

@Module({
  imports: [DatabaseModule, CLIAgentModule, CredentialsModule],
  controllers: [ExecutionProfileController, NativeCliIntegrationController, DevinIntegrationController],
  providers: [ExecutionProfileService, CodexAppServerHost, CodexAppServerLLMSource, ClaudeAgentSdkLLMSource, DevinApiClient, DevinApiLLMSource, NativeApprovalService, CodexMcpPolicyService],
  exports: [ExecutionProfileService, CodexAppServerHost, CodexAppServerLLMSource, ClaudeAgentSdkLLMSource, DevinApiClient, DevinApiLLMSource, NativeApprovalService, CodexMcpPolicyService],
})
export class AgentRuntimeModule {}
