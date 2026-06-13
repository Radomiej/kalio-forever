import { Module } from '@nestjs/common';
import { ArchitectureModule } from '../architecture/architecture.module';
import { ChatModule } from '../chat/chat.module';
import { VFSModule } from '../vfs/vfs.module';
import { ArchitectureAgentFlowAdapter } from './architecture-agent-flow.adapter';
import { AgentFlowRunsController } from './agent-flow-runs.controller';
import { AgentFlowRunRepository } from './agent-flow-run.repository';
import { AgentFlowRuntimeService } from './agent-flow-runtime.service';
import { AGENT_FLOW_RUNTIME } from './agent-flow-runtime.port';

@Module({
  imports: [ArchitectureModule, ChatModule, VFSModule],
  controllers: [AgentFlowRunsController],
  providers: [
    ArchitectureAgentFlowAdapter,
    AgentFlowRunRepository,
    AgentFlowRuntimeService,
    {
      provide: AGENT_FLOW_RUNTIME,
      useExisting: AgentFlowRuntimeService,
    },
  ],
  exports: [AGENT_FLOW_RUNTIME],
})
export class AgentFlowModule {}
