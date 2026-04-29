import { Module } from '@nestjs/common';
import { AgentLoopController } from './agent-loop.controller';
import { AgentLoopService } from './agent-loop.service';

@Module({
  controllers: [AgentLoopController],
  providers: [AgentLoopService],
})
export class AgentLoopModule {}
