import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { AuditModule } from '../chat/audit.module';
import { AllowedPathsModule } from '../allowed-paths/allowed-paths.module';
import { CLIAgentService } from './cli-agent.service';
import { CLIAgentProbeService } from './cli-agent-probe.service';
import { CLIAgentLaunchPreparationService } from './cli-agent-launch-preparation.service';
import { CLIAgentConfigService } from './cli-agent-config.service';
import { CLIAgentController } from './cli-agent.controller';
import { CopilotAdapter } from './adapters/copilot.adapter';
import { GeminiAdapter } from './adapters/gemini.adapter';
import { ClaudeCodeAdapter } from './adapters/claude-code.adapter';
import { CodexAdapter } from './adapters/codex.adapter';
import { CLIAgentSessionService } from './cli-agent-session.service';
import { CLIAgentSessionRuntimeService } from './cli-agent-session-runtime.service';
import { CLI_AGENT_SESSION_RUNTIME } from './cli-agent-session-runtime.port';
import { CLIAgentPtyService } from './cli-agent-pty.service';

@Module({
  imports: [DatabaseModule, AuditModule, AllowedPathsModule],
  controllers: [CLIAgentController],
  providers: [
    CLIAgentService,
    CLIAgentProbeService,
    CLIAgentLaunchPreparationService,
    CLIAgentConfigService,
    CLIAgentPtyService,
    CLIAgentSessionService,
    CLIAgentSessionRuntimeService,
    {
      provide: CLI_AGENT_SESSION_RUNTIME,
      useExisting: CLIAgentSessionRuntimeService,
    },
    CopilotAdapter,
    GeminiAdapter,
    ClaudeCodeAdapter,
    CodexAdapter,
  ],
  exports: [
    CLIAgentService,
    CLIAgentConfigService,
    CLIAgentPtyService,
    CLIAgentSessionService,
    CLIAgentSessionRuntimeService,
    CLI_AGENT_SESSION_RUNTIME,
  ],
})
export class CLIAgentModule {}
