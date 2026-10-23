import { Module } from '@nestjs/common';
import { EXECUTION_PROFILE_LOOKUP, type ExecutionProfileLookupPort } from '@kalio/types';
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
import { DefaultExecutionProfileService } from './default-execution-profile.service';
import { DefaultExecutionProfileController } from './default-execution-profile.controller';
import { resolveExecutionProfileId } from './execution-profile.utils';

export const executionProfileLookupProvider = {
  provide: EXECUTION_PROFILE_LOOKUP,
  inject: [ExecutionProfileService, DefaultExecutionProfileService],
  useFactory: (profiles: ExecutionProfileService, defaults: DefaultExecutionProfileService): ExecutionProfileLookupPort => ({
    assertEnabled: id => profiles.assertEnabled(id),
    getDefaultId: () => defaults.getId(),
    resolveId: resolveExecutionProfileId,
  }),
};

@Module({
  imports: [DatabaseModule, AuditModule, CLIAgentModule, CredentialsModule, KalioMcpBridgeContextModule],
  controllers: [DefaultExecutionProfileController, ExecutionProfileController, NativeCliIntegrationController, DevinIntegrationController, DevinCliIntegrationController],
  // Cross-module readers consume the shared identity port, not this service class.
  providers: [executionProfileLookupProvider, DefaultExecutionProfileService, ExecutionProfileService, CodexAppServerHost, CodexAppServerLLMSource, ClaudeAgentSdkLLMSource, DevinApiClient, DevinApiLLMSource, DevinAcpHostRegistry, DevinCliModelCatalogService, DevinCliCommandQueueService, DevinCliProbeService, DevinCliAcpLLMSource, NativeApprovalService, CodexMcpPolicyService, DevinNativeToolsPolicyService],
  exports: [EXECUTION_PROFILE_LOOKUP, DefaultExecutionProfileService, ExecutionProfileService, CodexAppServerHost, CodexAppServerLLMSource, ClaudeAgentSdkLLMSource, DevinApiClient, DevinApiLLMSource, DevinAcpHostRegistry, DevinCliModelCatalogService, DevinCliAcpLLMSource, NativeApprovalService, CodexMcpPolicyService, DevinNativeToolsPolicyService],
})
export class AgentRuntimeModule {}
