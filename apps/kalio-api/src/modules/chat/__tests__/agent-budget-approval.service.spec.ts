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

  it.each([
    ['allow_one', 6],
    ['allow_ten', 15],
    ['allow_unlimited', 1000],
  ] as const)('resolves %s approvals with the expected limit and runtime payload', async (decision, expectedLimit) => {
    const service = new AgentBudgetApprovalService();
    const abortController = new AbortController();
    const events: Array<{ event: string; data: unknown }> = [];
    const agentRun = {
      agentRunId: 'run-1',
      runId: 'run-1',
      role: 'pragmatist',
      agentType: 'subagent',
      parentSessionId: 'parent-session-1',
    } as StreamContext['agentRun'];

    const approvalPromise = service.requestAdditionalBudget({
      sessionId: 'session-approved',
      messageId: 'message-1',
      turnId: 'turn-1',
      promptMessageId: 'prompt-1',
      agentRun,
      abortSignal: abortController.signal,
      state: {} as StreamContext['state'],
      emit: (event, data) => {
        events.push({ event, data });
      },
    }, {
      currentLimit: 5,
      usedIterations: 5,
      runtimeKind: 'agent-flow-branch',
      nodeId: 'node-1',
      roleSlotId: 'role-1',
      requestedBy: 'pragmatist',
    });

    const budgetRequired = events.find(({ event }) => event === 'agent:budget_required');
    expect(budgetRequired?.data).toEqual(expect.objectContaining({
      sessionId: 'session-approved',
      turnId: 'turn-1',
      promptMessageId: 'prompt-1',
      scope: 'agent-flow-branch',
      currentLimit: 5,
      suggestedNextLimit: 15,
      usedIterations: 5,
      agentRun,
      nodeId: 'node-1',
      roleSlotId: 'role-1',
      requestedBy: 'pragmatist',
    }));
    const request = budgetRequired?.data as AgentBudgetApprovalRequest | undefined;
    if (!request) {
      throw new Error('Expected budget approval request to be emitted');
    }

    expect(service.resolveApproval(request.requestId, 'session-approved', decision)).toBe('resolved');
    await expect(approvalPromise).resolves.toBe(expectedLimit);
    expect(service.getPendingApprovals('session-approved')).toEqual([]);
    expect(events).toContainEqual({
      event: 'agent:budget_invalidated',
      data: expect.objectContaining({
        requestId: request.requestId,
        sessionId: 'session-approved',
        reason: 'approved',
        decision,
        approvedLimit: expectedLimit,
      }),
    });
  });

  it('keeps synthetic pending approvals isolated to the matching session', () => {
    const service = new AgentBudgetApprovalService();
    const payload: AgentBudgetApprovalRequest = {
      requestId: 'synthetic-1',
      sessionId: 'session-synthetic',
      messageId: 'message-1',
      currentLimit: 3,
      suggestedNextLimit: 9,
      usedIterations: 3,
      runtimeKind: 'agent-flow-branch',
    };

    service.seedPendingApproval(payload);

    expect(service.isSyntheticPendingApproval('synthetic-1', 'session-synthetic')).toBe(true);
    expect(service.isSyntheticPendingApproval('synthetic-1', 'other-session')).toBe(false);
    expect(service.resolveApproval('synthetic-1', 'other-session', 'allow_one')).toBe('session_mismatch');
    expect(service.dropPendingApproval('synthetic-1', 'other-session')).toBe('session_mismatch');
    expect(service.getPendingApprovals('session-synthetic')).toEqual([payload]);
    expect(service.dropPendingApproval('synthetic-1', 'session-synthetic')).toBe('removed');
    expect(service.isSyntheticPendingApproval('synthetic-1', 'session-synthetic')).toBe(false);
  });
});
