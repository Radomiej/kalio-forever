import { describe, expect, it, vi } from 'vitest';
import type { AgentBudgetApprovalRequest } from '@kalio/types';
import { AgentBudgetApprovalService } from '../agent-budget-approval.service';
import type { StreamContext } from '../interfaces/stream-context.interface';

describe('AgentBudgetApprovalService', () => {
  it('stores pending budget approval before emitting the live event', async () => {
    const service = new AgentBudgetApprovalService();
    const abortController = new AbortController();
    let emittedPayload: AgentBudgetApprovalRequest | null = null;
    let pendingAtEmit: AgentBudgetApprovalRequest[] = [];

    const ctx: StreamContext = {
      sessionId: 'session-1',
      messageId: 'message-1',
      abortSignal: abortController.signal,
      state: {} as StreamContext['state'],
      emit: (event, data) => {
        if (event !== 'agent:budget_required') {
          return;
        }
        const request = data as AgentBudgetApprovalRequest;
        emittedPayload = request;
        pendingAtEmit = service.getPendingApprovals(request.sessionId);
      },
    };

    const approvalPromise = service.requestAdditionalBudget(ctx, {
      currentLimit: 1,
      usedIterations: 1,
      runtimeKind: 'agent-flow-branch',
      nodeId: 'node-1',
      roleSlotId: 'role-1',
    });

    expect(emittedPayload).not.toBeNull();
    expect(pendingAtEmit).toEqual([emittedPayload]);
    const pendingRequest = pendingAtEmit[0];
    if (!pendingRequest) {
      throw new Error('Expected budget approval request to be pending at emit time');
    }

    const result = service.resolveApproval(pendingRequest.requestId, 'session-1', 'block');
    expect(result).toBe('resolved');
    await expect(approvalPromise).resolves.toBeNull();
  });

  it('invalidates a pending request when emit triggers an immediate abort', async () => {
    const service = new AgentBudgetApprovalService();
    const abortController = new AbortController();
    const emit = vi.fn((event: string) => {
      if (event === 'agent:budget_required') {
        abortController.abort();
      }
    });

    const approvalPromise = service.requestAdditionalBudget({
      sessionId: 'session-emit-abort',
      messageId: 'message-1',
      abortSignal: abortController.signal,
      state: {} as StreamContext['state'],
      emit,
    }, {
      currentLimit: 5,
      usedIterations: 5,
      runtimeKind: 'agent-flow-branch',
    });

    await expect(approvalPromise).resolves.toBeNull();
    expect(service.getPendingApprovals('session-emit-abort')).toEqual([]);
    expect(emit).toHaveBeenCalledWith('agent:budget_required', expect.objectContaining({
      sessionId: 'session-emit-abort',
      currentLimit: 5,
      suggestedNextLimit: 15,
    }));
    expect(emit).toHaveBeenCalledWith('agent:budget_invalidated', expect.objectContaining({
      sessionId: 'session-emit-abort',
      reason: 'aborted',
    }));
  });

  it('does not emit budget_required when the signal is already aborted', async () => {
    const service = new AgentBudgetApprovalService();
    const abortController = new AbortController();
    abortController.abort();
    const emit = vi.fn();

    const approvalPromise = service.requestAdditionalBudget({
      sessionId: 'session-preaborted',
      messageId: 'message-1',
      abortSignal: abortController.signal,
      state: {} as StreamContext['state'],
      emit,
    }, {
      currentLimit: 2,
      usedIterations: 2,
      runtimeKind: 'agent-flow-branch',
    });

    await expect(approvalPromise).resolves.toBeNull();
    expect(service.getPendingApprovals('session-preaborted')).toEqual([]);
    expect(emit).not.toHaveBeenCalledWith('agent:budget_required', expect.anything());
    expect(emit).toHaveBeenCalledWith('agent:budget_invalidated', expect.objectContaining({
      sessionId: 'session-preaborted',
      reason: 'aborted',
    }));
  });
});
