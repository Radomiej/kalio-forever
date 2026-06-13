import { Body, Controller, Post } from '@nestjs/common';
import type { AgentBudgetApprovalRequest, AgentRunContext } from '@kalio/types';
import { ChatTestSupportService } from './chat-test-support.service';

interface SeedBudgetReplayFixtureDto {
  sessionId: string;
  requestId: string;
  promptMessage: string;
  currentLimit: number;
  usedIterations: number;
  turnId?: string;
  scope?: 'chat' | 'subagent' | 'agent-flow-branch';
  requestedBy?: string;
  personaId?: string;
  nodeId?: string;
  roleSlotId?: string;
  agentRun?: AgentRunContext;
}

interface DropPendingBudgetApprovalDto {
  requestId: string;
  sessionId?: string;
}

@Controller('test-support/agent-budget')
export class ChatTestSupportAgentBudgetController {
  constructor(private readonly chatTestSupport: ChatTestSupportService) {}

  @Post('seed-replay')
  seedReplay(@Body() body: SeedBudgetReplayFixtureDto): Promise<AgentBudgetApprovalRequest> {
    return this.chatTestSupport.seedBudgetReplayFixture(body);
  }

  @Post('drop')
  drop(@Body() body: DropPendingBudgetApprovalDto): { status: 'removed' | 'not_found' | 'session_mismatch' } {
    return this.chatTestSupport.dropPendingBudgetApproval(body);
  }
}
