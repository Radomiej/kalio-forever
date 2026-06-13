import type { AgentBudgetApprovalRequest } from '@kalio/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatTestSupportAgentBudgetController } from './chat-test-support-agent-budget.controller';

function makeService() {
  return {
    seedBudgetReplayFixture: vi.fn(),
    dropPendingBudgetApproval: vi.fn(),
  };
}

describe('ChatTestSupportAgentBudgetController', () => {
  let service: ReturnType<typeof makeService>;
  let controller: ChatTestSupportAgentBudgetController;

  beforeEach(() => {
    service = makeService();
    controller = new ChatTestSupportAgentBudgetController(service as never);
  });

  it('delegates budget replay seeding to ChatTestSupportService', async () => {
    const response: AgentBudgetApprovalRequest = {
      requestId: 'budget-1',
      sessionId: 'sess-1',
      scope: 'chat',
      usedIterations: 60,
      currentLimit: 60,
      suggestedNextLimit: 70,
      requestedBy: 'chat-agent',
    };
    service.seedBudgetReplayFixture.mockResolvedValue(response);

    const body = {
      sessionId: 'sess-1',
      requestId: 'budget-1',
      promptMessage: 'Need more tool calls.',
      currentLimit: 60,
      usedIterations: 60,
      requestedBy: 'chat-agent',
    };

    await expect(controller.seedReplay(body)).resolves.toEqual(response);
    expect(service.seedBudgetReplayFixture).toHaveBeenCalledWith(body);
  });

  it('delegates budget replay cleanup to ChatTestSupportService', () => {
    service.dropPendingBudgetApproval.mockReturnValue({ status: 'removed' });

    const body = {
      requestId: 'budget-1',
      sessionId: 'sess-1',
    };

    expect(controller.drop(body)).toEqual({ status: 'removed' });
    expect(service.dropPendingBudgetApproval).toHaveBeenCalledWith(body);
  });
});
