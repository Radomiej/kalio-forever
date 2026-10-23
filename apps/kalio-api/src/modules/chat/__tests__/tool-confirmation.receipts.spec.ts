import { describe, expect, it, vi } from 'vitest';
import type { HitlPolicyService } from '../../hitl/hitl-policy.service';
import { ToolConfirmationService } from '../tool-confirmation.service';
import { TurnState } from '../turn-state';
import type { StreamContext } from '../interfaces/stream-context.interface';

function context(observed: boolean): StreamContext {
  return { sessionId: 'session', runId: 'journal', turnId: 'turn', promptMessageId: 'prompt', messageId: 'message',
    state: new TurnState(), emit: () => undefined, abortSignal: new AbortController().signal,
    ...(observed ? { onResolvedToolDispatch: async () => undefined } : {}) };
}

describe('confirmation receipt boundaries', () => {
  it.each([false, true])('classifies policy only for observed consumers (observed=%s)', async observed => {
    const policy = { resolveApproval: async () => ({ status: 'approved', source: 'jev' }) } as unknown as HitlPolicyService;
    const service = new ToolConfirmationService(policy, null);
    expect(await service.approveOrRequestConfirmation('call', 'tool', {}, context(observed))).toEqual(
      observed ? { approved: true, nonDurableReason: 'policy' } : { approved: true });
  });

  it.each([false, true])('does not fabricate durable receipts for legacy manual approvals (observed=%s)', async observed => {
    const service = new ToolConfirmationService(null, null);
    const approval = service.approveOrRequestConfirmation('call', 'tool', {}, context(observed));
    await vi.waitFor(() => expect(service.getPendingConfirmations('session')).toHaveLength(1));
    await service.resolveConfirmation(service.getPendingConfirmations('session')[0]!.requestId, 'session');
    expect(await approval).toEqual(observed ? { approved: true, nonDurableReason: 'legacy_confirmation' } : { approved: true });
  });

  it('required commit fails statically without persistence, while legacy API remains void', async () => {
    const service = new ToolConfirmationService(null, null);
    await expect(service.finishLiveExecutionRequired({ requestId: 'secret', revision: 3 }, { status: 'success' }))
      .rejects.toThrow(/^HITL_EXECUTION_COMMIT_FAILED$/);
    await expect(service.finishLiveExecution({ requestId: 'legacy', revision: 3 }, { status: 'success' }))
      .rejects.toThrow('Unable to commit durable tool execution legacy');
  });
});
