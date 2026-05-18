import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { AllowedPathsModule } from '../allowed-paths/allowed-paths.module';
import { CLIAgentService } from './cli-agent.service';
import { CLIAgentConfigService } from './cli-agent-config.service';
import { CLIAgentController } from './cli-agent.controller';
import { CopilotAdapter } from './adapters/copilot.adapter';
import { GeminiAdapter } from './adapters/gemini.adapter';
import { ClaudeCodeAdapter } from './adapters/claude-code.adapter';
import { CodexAdapter } from './adapters/codex.adapter';
import { CLIAgentSessionService } from './cli-agent-session.service';
import { CLIAgentSessionRuntimeService } from './cli-agent-session-runtime.service';

@Module({
  imports: [DatabaseModule, AllowedPathsModule],
  controllers: [CLIAgentController],
  providers: [
    CLIAgentService,
    CLIAgentConfigService,
    CLIAgentSessionService,
    CLIAgentSessionRuntimeService,
    CopilotAdapter,
    GeminiAdapter,
    ClaudeCodeAdapter,
    CodexAdapter,
  ],
  exports: [CLIAgentService, CLIAgentConfigService, CLIAgentSessionService, CLIAgentSessionRuntimeService],
})
export class CLIAgentModule {}
