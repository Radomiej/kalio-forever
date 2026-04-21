import { Module } from '@nestjs/common';
import { AgentLoopService } from './agent-loop.service';
import { ForeverAgentService } from './forever-agent.service';
import { AgentLoopController } from './agent-loop.controller';
import { LLMModule } from '../llm/llm.module';
import { ToolModule } from '../tool/tool.module';

@Module({
  imports: [LLMModule, ToolModule],
  controllers: [AgentLoopController],
  providers: [AgentLoopService, ForeverAgentService],
  exports: [AgentLoopService, ForeverAgentService],
})
export class AgentLoopModule {}
