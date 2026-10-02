import { describe, expect, it, vi } from 'vitest';
import type { HitlPolicyService } from '../hitl/hitl-policy.service';
import type { StreamContext } from './interfaces/stream-context.interface';
import { ToolConfirmationService } from './tool-confirmation.service';

describe('ToolConfirmationService cancellation', () => {
  it('does not emit or persist a manual confirmation after policy cancellation', async () => {
    const controller = new AbortController();
    const reason = new DOMException('Stopped by user', 'AbortError');
    const policy = { resolveApproval: vi.fn(async () => {
      controller.abort(reason);
      throw reason;
    }) };
    const service = new ToolConfirmationService(policy as unknown as HitlPolicyService, null);
    const emit = vi.fn();
    const markWaitingForHuman = vi.fn();
    const context = { sessionId: 'session', abortSignal: controller.signal, emit, markWaitingForHuman } as unknown as StreamContext;

    await expect(service.approveOrRequestConfirmation('call', 'terminal_exec', {}, context)).rejects.toBe(reason);
    expect(emit).not.toHaveBeenCalled();
    expect(markWaitingForHuman).not.toHaveBeenCalled();
    expect(service.getPendingConfirmations('session')).toEqual([]);
  });
});
