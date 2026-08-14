import { Test } from '@nestjs/testing';
import { describe, expect, it, vi } from 'vitest';
import { HitlRequestService } from '../../hitl/hitl-request.service';
import { RAAppHITLService } from '../../raapp/raapp-hitl.service';
import { AgentBudgetApprovalService } from '../agent-budget-approval.service';
import { ChatGateway } from '../chat.gateway';
import { ChatService } from '../chat.service';
import { SessionEventsService } from '../session-events.service';
import { SessionPipelineService } from '../session-pipeline.service';
import { SessionsService } from '../sessions.service';
import { ToolDispatchService } from '../tool-dispatch.service';

describe('ChatGateway dependency injection', () => {
  it('injects durable HITL replay and continuation services', async () => {
    const hitlRequests = { listPendingToolConfirmations: vi.fn().mockResolvedValue([]) };
    const chatService = { approveAndResumeTool: vi.fn().mockResolvedValue(false) };
    const moduleRef = await Test.createTestingModule({
      providers: [
        ChatGateway,
        { provide: ToolDispatchService, useValue: { getPendingConfirmations: vi.fn().mockReturnValue([]) } },
        { provide: SessionPipelineService, useValue: {} },
        { provide: RAAppHITLService, useValue: {} },
        { provide: SessionsService, useValue: {} },
        {
          provide: SessionEventsService,
          useValue: {
            onSessionCreated: vi.fn(),
            onSessionUpdated: vi.fn(),
          },
        },
        { provide: AgentBudgetApprovalService, useValue: {} },
        { provide: HitlRequestService, useValue: hitlRequests },
        { provide: ChatService, useValue: chatService },
      ],
    }).compile();

    const gateway = moduleRef.get(ChatGateway) as unknown as {
      hitlRequests?: unknown;
      chatService?: unknown;
    };
    expect(gateway.hitlRequests).toBe(hitlRequests);
    expect(gateway.chatService).toBe(chatService);
  });
});
