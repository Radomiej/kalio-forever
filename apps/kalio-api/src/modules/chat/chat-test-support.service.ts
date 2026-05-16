import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AgentRunContext, ChatMessage, ToolConfirmationRequest } from '@kalio/types';
import { nanoid } from 'nanoid';
import { MESSAGE_REPOSITORY } from './chat.tokens';
import type { IMessageRepository } from './interfaces/message-repository.interface';
import { SessionsService } from './sessions.service';
import { ToolDispatchService } from './tool-dispatch.service';

interface SeedReplayFixtureInput {
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

interface DropPendingConfirmationInput {
  requestId: string;
  sessionId?: string;
}

@Injectable()
export class ChatTestSupportService {
  constructor(
    private readonly config: ConfigService,
    private readonly sessions: SessionsService,
    private readonly toolDispatch: ToolDispatchService,
    @Inject(MESSAGE_REPOSITORY) private readonly repo: IMessageRepository,
  ) {}

  async seedReplayFixture(input: SeedReplayFixtureInput): Promise<ToolConfirmationRequest> {
    this.assertTestMode();
    await this.sessions.get(input.sessionId);

    const now = Date.now();
    const promptMessage: ChatMessage = {
      id: nanoid(),
      sessionId: input.sessionId,
      role: 'user',
      content: input.promptMessage,
      createdAt: now,
    };
    const assistantMessage: ChatMessage = {
      id: nanoid(),
      sessionId: input.sessionId,
      role: 'assistant',
      content: input.assistantMessage,
      toolCalls: [{
        id: input.toolCallId,
        name: input.toolName,
        args: input.args,
      }],
      createdAt: now + 1,
    };

    await this.repo.saveMessage(promptMessage);
    await this.repo.saveMessage(assistantMessage);

    const payload: ToolConfirmationRequest = {
      requestId: input.requestId,
      toolCallId: input.toolCallId,
      sessionId: input.sessionId,
      toolName: input.toolName,
      args: input.args,
      timeoutMs: input.timeoutMs ?? 600_000,
      agentRun: input.agentRun,
    };

    this.toolDispatch.seedPendingConfirmation(payload);
    return payload;
  }

  dropPendingConfirmation(input: DropPendingConfirmationInput): { status: 'removed' | 'not_found' | 'session_mismatch' } {
    this.assertTestMode();
    return {
      status: this.toolDispatch.dropPendingConfirmation(input.requestId, input.sessionId),
    };
  }

  private assertTestMode(): void {
    if (this.config.get<string>('NODE_ENV', 'development') !== 'test') {
      throw new NotFoundException();
    }
  }
}