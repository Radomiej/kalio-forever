import { Body, Controller, Post } from '@nestjs/common';
import type { AgentRunContext, ToolConfirmationRequest } from '@kalio/types';
import { ChatTestSupportService } from './chat-test-support.service';

interface SeedReplayFixtureDto {
  sessionId: string;
  requestId: string;
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  promptMessage: string;
  assistantMessage: string;
  timeoutMs?: number;
  agentRun?: AgentRunContext;
}

interface DropPendingConfirmationDto {
  requestId: string;
  sessionId?: string;
}

@Controller('test-support/tool-confirmations')
export class ChatTestSupportController {
  constructor(private readonly chatTestSupport: ChatTestSupportService) {}

  @Post('seed-replay')
  seedReplay(@Body() body: SeedReplayFixtureDto): Promise<ToolConfirmationRequest> {
    return this.chatTestSupport.seedReplayFixture(body);
  }

  @Post('drop')
  drop(@Body() body: DropPendingConfirmationDto): { status: 'removed' | 'not_found' | 'session_mismatch' } {
    return this.chatTestSupport.dropPendingConfirmation(body);
  }
}