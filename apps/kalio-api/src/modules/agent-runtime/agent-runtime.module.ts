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
import { DevinCliIntegrationController } from './devin-cli-integration.controller';
import { DevinAcpHostRegistry } from './devin-cli-acp.host';
import { DevinCliAcpLLMSource } from './devin-cli-acp.llm-source';
import { NativeApprovalService } from './native-approval.service';
import { NativeCliIntegrationController } from './native-cli-integration.controller';
import { CodexMcpPolicyService } from './codex-mcp-policy.service';
import { DevinNativeToolsPolicyService } from './devin-native-tools-policy.service';
import { KalioMcpBridgeContextModule } from '../../common/kalio-mcp-bridge-context.module';

@Module({
  imports: [DatabaseModule, CLIAgentModule, CredentialsModule, KalioMcpBridgeContextModule],
  controllers: [ExecutionProfileController, NativeCliIntegrationController, DevinIntegrationController, DevinCliIntegrationController],
  providers: [ExecutionProfileService, CodexAppServerHost, CodexAppServerLLMSource, ClaudeAgentSdkLLMSource, DevinApiClient, DevinApiLLMSource, DevinAcpHostRegistry, DevinCliAcpLLMSource, NativeApprovalService, CodexMcpPolicyService, DevinNativeToolsPolicyService],
  exports: [ExecutionProfileService, CodexAppServerHost, CodexAppServerLLMSource, ClaudeAgentSdkLLMSource, DevinApiClient, DevinApiLLMSource, DevinAcpHostRegistry, DevinCliAcpLLMSource, NativeApprovalService, CodexMcpPolicyService, DevinNativeToolsPolicyService],
})
export class AgentRuntimeModule {}
