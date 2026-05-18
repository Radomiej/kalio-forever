import { Body, Controller, Post } from '@nestjs/common';
import type { RaAppNativeResult, RaAppPendingApproval } from '@kalio/types';
import type { PendingApproval } from '../raapp/effects-processor.service';
import { ChatTestSupportService } from './chat-test-support.service';

interface SeedRaAppHitlFixtureDto {
  sessionId: string;
  toolCallId: string;
  promptMessage: string;
  assistantMessage: string;
  block: {
    type: 'html' | 'gui';
    mode: 'display' | 'interactive';
    content: string;
    renderedContent?: string;
    vfsPath?: string;
  };
  approvals: PendingApproval[];
}

@Controller('test-support/raapp-hitl')
export class ChatTestSupportRaAppController {
  constructor(private readonly chatTestSupport: ChatTestSupportService) {}

  @Post('seed')
  seed(@Body() body: SeedRaAppHitlFixtureDto): Promise<{
    toolCallId: string;
    pendingApprovals: RaAppPendingApproval[];
    nativeResults: RaAppNativeResult[];
  }> {
    return this.chatTestSupport.seedRaAppHitlFixture(body);
  }
}