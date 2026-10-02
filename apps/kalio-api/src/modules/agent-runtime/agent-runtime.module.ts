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
import { DevinCliModelCatalogService } from './devin-cli-model-catalog.service';
import { DevinCliCommandQueueService } from './devin-cli-command-queue.service';
import { DevinCliProbeService } from './devin-cli-probe.service';
import { DevinCliAcpLLMSource } from './devin-cli-acp.llm-source';
import { NativeApprovalService } from './native-approval.service';
import { NativeCliIntegrationController } from './native-cli-integration.controller';
import { CodexMcpPolicyService } from './codex-mcp-policy.service';
import { DevinNativeToolsPolicyService } from './devin-native-tools-policy.service';
import { KalioMcpBridgeContextModule } from '../../common/kalio-mcp-bridge-context.module';
import { AuditModule } from '../chat/audit.module';

@Module({
  imports: [DatabaseModule, AuditModule, CLIAgentModule, CredentialsModule, KalioMcpBridgeContextModule],
  controllers: [ExecutionProfileController, NativeCliIntegrationController, DevinIntegrationController, DevinCliIntegrationController],
  providers: [ExecutionProfileService, CodexAppServerHost, CodexAppServerLLMSource, ClaudeAgentSdkLLMSource, DevinApiClient, DevinApiLLMSource, DevinAcpHostRegistry, DevinCliModelCatalogService, DevinCliCommandQueueService, DevinCliProbeService, DevinCliAcpLLMSource, NativeApprovalService, CodexMcpPolicyService, DevinNativeToolsPolicyService],
  exports: [ExecutionProfileService, CodexAppServerHost, CodexAppServerLLMSource, ClaudeAgentSdkLLMSource, DevinApiClient, DevinApiLLMSource, DevinAcpHostRegistry, DevinCliModelCatalogService, DevinCliAcpLLMSource, NativeApprovalService, CodexMcpPolicyService, DevinNativeToolsPolicyService],
})
export class AgentRuntimeModule {}
