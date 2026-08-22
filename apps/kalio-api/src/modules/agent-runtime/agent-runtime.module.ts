import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { ExecutionProfileController } from './execution-profile.controller';
import { ExecutionProfileService } from './execution-profile.service';
import { CodexAppServerHost } from './codex-app-server.host';
import { CodexAppServerLLMSource } from './codex-app-server.llm-source';
import { NativeApprovalService } from './native-approval.service';
import { NativeCliIntegrationController } from './native-cli-integration.controller';

@Module({
  imports: [DatabaseModule],
  controllers: [ExecutionProfileController, NativeCliIntegrationController],
  providers: [ExecutionProfileService, CodexAppServerHost, CodexAppServerLLMSource, NativeApprovalService],
  exports: [ExecutionProfileService, CodexAppServerHost, CodexAppServerLLMSource, NativeApprovalService],
})
export class AgentRuntimeModule {}
