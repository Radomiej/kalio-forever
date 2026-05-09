import { Module } from '@nestjs/common';
import { CLIAgentService } from './cli-agent.service';
import { CLIAgentConfigService } from './cli-agent-config.service';
import { CLIAgentController } from './cli-agent.controller';
import { CopilotAdapter } from './adapters/copilot.adapter';
import { GeminiAdapter } from './adapters/gemini.adapter';
import { ClaudeCodeAdapter } from './adapters/claude-code.adapter';

@Module({
  controllers: [CLIAgentController],
  providers: [
    CLIAgentService,
    CLIAgentConfigService,
    CopilotAdapter,
    GeminiAdapter,
    ClaudeCodeAdapter,
  ],
  exports: [CLIAgentService, CLIAgentConfigService],
})
export class CLIAgentModule {}
