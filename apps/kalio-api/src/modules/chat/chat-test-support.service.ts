import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AgentRunContext, ChatMessage, RaAppNativeResult, RaAppPendingApproval, ToolConfirmationRequest } from '@kalio/types';
import { nanoid } from 'nanoid';
import type { PendingApproval } from '../raapp/effects-processor.service';
import { RAAppHITLService } from '../raapp/raapp-hitl.service';
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

interface SeedRaAppHitlFixtureInput {
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

interface SeedRaAppHitlFixtureResult {
  toolCallId: string;
  pendingApprovals: RaAppPendingApproval[];
  nativeResults: RaAppNativeResult[];
}

@Injectable()
export class ChatTestSupportService {
  constructor(
    private readonly config: ConfigService,
    private readonly sessions: SessionsService,
    private readonly toolDispatch: ToolDispatchService,
    private readonly raappHitl: RAAppHITLService,
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

  async seedRaAppHitlFixture(input: SeedRaAppHitlFixtureInput): Promise<SeedRaAppHitlFixtureResult> {
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
        name: 'run_raapp',
        args: { id: 'seeded-raapp-hitl-fixture' },
      }],
      createdAt: now + 1,
    };

    const resolved = await this.raappHitl.resolvePendingApprovals(
      input.toolCallId,
      input.sessionId,
      input.approvals,
    );

    const toolResultPayload = {
      status: 'ready' as const,
      type: input.block.type,
      mode: input.block.mode,
      content: input.block.content,
      ...(input.block.renderedContent !== undefined ? { renderedContent: input.block.renderedContent } : {}),
      ...(input.block.vfsPath !== undefined ? { vfsPath: input.block.vfsPath } : {}),
      ...(resolved.pendingApprovals.length > 0 ? { pendingApprovals: resolved.pendingApprovals } : {}),
      ...(resolved.nativeResults.length > 0 ? { nativeResults: resolved.nativeResults } : {}),
    };
    const toolResultMessage: ChatMessage = {
      id: nanoid(),
      sessionId: input.sessionId,
      role: 'tool_result',
      toolCallId: input.toolCallId,
      content: JSON.stringify(toolResultPayload),
      createdAt: now + 2,
    };

    await this.repo.saveMessage(promptMessage);
    await this.repo.saveMessage(assistantMessage);
    await this.repo.saveMessage(toolResultMessage);

    return {
      toolCallId: input.toolCallId,
      pendingApprovals: resolved.pendingApprovals,
      nativeResults: resolved.nativeResults,
    };
  }

  private assertTestMode(): void {
    if (this.config.get<string>('NODE_ENV', 'development') !== 'test') {
      throw new NotFoundException();
    }
  }
}