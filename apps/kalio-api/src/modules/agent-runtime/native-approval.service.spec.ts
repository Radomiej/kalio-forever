import { describe, expect, it, vi } from 'vitest';
import type { ToolConfirmationInvalidated, ToolConfirmationRequest } from '@kalio/types';
import { NativeApprovalService } from './native-approval.service';

describe('NativeApprovalService', () => {
  it('exposes a Codex native request through the existing confirmation events', async () => {
    const service = new NativeApprovalService();
    const events: Array<{ event: string; data: ToolConfirmationRequest | ToolConfirmationInvalidated }> = [];
    const emit = (event: 'tool:confirmation_required' | 'tool:confirmation_invalidated', data: ToolConfirmationRequest | ToolConfirmationInvalidated): void => {
      events.push({ event, data });
    };
    const pending = service.request({
      sessionId: 'session-1',
      turnId: 'turn-1',
      method: 'item/commandExecution/requestApproval',
      params: { command: 'pnpm test' },
      emit,
    });

    await vi.waitFor(() => expect(events).toHaveLength(1));
    const request = events[0]!.data as ToolConfirmationRequest;
    expect(request.toolName).toBe('codex_native:item/commandExecution/requestApproval');
    await expect(service.resolve(request.requestId, 'session-1', 'accept')).resolves.toBe(true);
    await expect(pending).resolves.toBe('accept');
    expect(events[1]).toMatchObject({
      event: 'tool:confirmation_invalidated',
      data: { requestId: request.requestId, reason: 'confirmed' },
    });
  });

  it('rejects a resolution from another session and cancels on abort', async () => {
    const service = new NativeApprovalService();
    const emit = vi.fn();
    const controller = new AbortController();
    const pending = service.request({
      sessionId: 'session-1',
      method: 'item/fileChange/requestApproval',
      params: {},
      emit,
      abortSignal: controller.signal,
    });
    await vi.waitFor(() => expect(emit).toHaveBeenCalledTimes(1));
    const request = emit.mock.calls[0]?.[1] as ToolConfirmationRequest;
    await expect(service.resolve(request.requestId, 'session-2', 'accept')).resolves.toBe(false);
    controller.abort();
    await expect(pending).resolves.toBe('cancel');
  });
});
