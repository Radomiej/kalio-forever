import { describe, expect, it, vi } from 'vitest';
import { ToolConfirmationService } from '../tool-confirmation.service';
import { ToolDispatchService } from '../tool-dispatch.service';
import { TurnState } from '../turn-state';
import type { StreamContext } from '../interfaces/stream-context.interface';
import type { HitlPolicyService } from '../../hitl/hitl-policy.service';
import type { HitlNotificationService } from '../../hitl/hitl-notification.service';
import { RuntimeAuditLogger } from '../runtime-audit-logger.service';
import type { AuditService } from '../audit.service';

const reason = 'Local decision (fixture:1): ask_user. Need human context for this read.';
function fixture() {
  const policy = { resolveApproval: vi.fn().mockResolvedValue({ status: 'manual', source: 'manual', reason }) };
  const notifications = { notifyApprovalRequested: vi.fn().mockResolvedValue(undefined), logApprovalLifecycle: vi.fn().mockResolvedValue(undefined) };
  const writer = { log: vi.fn().mockResolvedValue('audit') };
  const runtime = new RuntimeAuditLogger(writer as unknown as AuditService);
  const audit = { log: vi.spyOn(runtime, 'log') };
  const service = new ToolConfirmationService(policy as unknown as HitlPolicyService,
    notifications as unknown as HitlNotificationService, runtime);
  const ctx: StreamContext = { sessionId: 'session', messageId: 'message', state: new TurnState(),
    abortSignal: new AbortController().signal, emit: vi.fn() };
  return { service, policy, notifications, audit, writer, ctx };
}
describe('manual supervisor reason remains request context, never human authority', () => {
  it.each(['approve', 'reject'] as const)('annotates only real requested event and separates later human %s reason', async action => {
    const f = fixture(); let settled = false;
    const waiting = f.service.approveOrRequestConfirmation('call', 'fs_read', {}, f.ctx);
    void waiting.then(() => { settled = true; });
    await vi.waitFor(() => expect(f.service.getPendingConfirmations('session')).toHaveLength(1));
    const request = f.service.getPendingConfirmations('session')[0]!;
    expect(settled).toBe(false);
    expect(f.notifications.notifyApprovalRequested).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      requestId: request.requestId, policyReason: reason,
    }));
    expect(f.audit.log).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ eventName: 'tool.confirmation.requested',
      status: 'waiting_for_human', data: expect.objectContaining({ requestId: request.requestId, message: reason }) }));
    expect(f.writer.log).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ type: 'runtime_event',
      label: 'tool.confirmation.requested', data: expect.objectContaining({ requestId: request.requestId,
        status: 'waiting_for_human', message: reason }) }));
    expect(f.notifications.logApprovalLifecycle).not.toHaveBeenCalled();
    expect(request).not.toHaveProperty('policyReason'); // no socket/shared payload extension
    const humanReason = 'Independent human decision';
    if (action === 'approve') await f.service.resolveConfirmation(request.requestId, 'session', humanReason);
    else await f.service.cancelConfirmation(request.requestId, 'session', humanReason);
    expect((await waiting).approved).toBe(action === 'approve');
    expect(f.notifications.logApprovalLifecycle).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      requestId: request.requestId, source: 'manual', reason: humanReason,
    }));
    expect(JSON.stringify(f.notifications.logApprovalLifecycle.mock.calls)).not.toContain(reason);
  });
  it.each(['humanOnly', 'throw', 'noReason'] as const)('does not attach a stale/absent policy reason for %s', async mode => {
    const f = fixture();
    if (mode === 'throw') f.policy.resolveApproval.mockRejectedValue(new Error('provider failed'));
    if (mode === 'noReason') f.policy.resolveApproval.mockResolvedValue({ status: 'manual', source: 'manual' });
    const waiting = f.service.approveOrRequestConfirmation('call', 'fs_read', {}, f.ctx, mode === 'humanOnly');
    await vi.waitFor(() => expect(f.service.getPendingConfirmations('session')).toHaveLength(1));
    const request = f.service.getPendingConfirmations('session')[0]!;
    expect(f.notifications.notifyApprovalRequested.mock.calls[0]![0]).not.toHaveProperty('policyReason');
    expect(f.audit.log.mock.calls[0]![0].data).not.toHaveProperty('message');
    if (mode === 'humanOnly') expect(f.policy.resolveApproval).not.toHaveBeenCalled();
    await f.service.cancelConfirmation(request.requestId, 'session'); expect((await waiting).approved).toBe(false);
  });
  it('human approval without a message does not acquire the supervisor reason', async () => {
    const f = fixture(); const waiting = f.service.approveOrRequestConfirmation('call', 'fs_read', {}, f.ctx);
    await vi.waitFor(() => expect(f.service.getPendingConfirmations('session')).toHaveLength(1));
    await f.service.resolveConfirmation(f.service.getPendingConfirmations('session')[0]!.requestId, 'session');
    expect((await waiting).approved).toBe(true);
    expect(f.notifications.logApprovalLifecycle.mock.calls[0]![0]).not.toHaveProperty('reason');
  });
  it('does not execute the actual dispatcher tool while waiting or after a human rejects it', async () => {
    const f = fixture(); const execute = vi.fn(async () => 'tool result');
    const dispatcher = new ToolDispatchService([{ meta: { name: 'fs_read', description: 'fixture',
      parameters: {}, requiresConfirmation: true }, execute }], null, null, null, null, f.service);
    const dispatched = dispatcher.dispatch('call', 'fs_read', {}, f.ctx);
    await vi.waitFor(() => expect(f.service.getPendingConfirmations('session')).toHaveLength(1));
    expect(execute).not.toHaveBeenCalled();
    const request = f.service.getPendingConfirmations('session')[0]!;
    expect(f.writer.log.mock.calls[0]![0].data).toMatchObject({ requestId: request.requestId, message: reason });
    await f.service.cancelConfirmation(request.requestId, 'session', 'Human rejects');
    expect(await dispatched).toMatchObject({ status: 'cancelled' }); expect(execute).not.toHaveBeenCalled();
  });
});
