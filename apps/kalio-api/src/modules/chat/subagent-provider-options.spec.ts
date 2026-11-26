import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolConfirmationRequest } from '@kalio/types';
import { NativeApprovalService } from '../agent-runtime/native-approval.service';
import { buildSubagentProviderOptions } from './subagent-provider-options';
import { createSubagentExecutionBudget } from './subagent-execution-budget';

const devinRequest = {
  method: 'devin.session.request_permission',
  params: { sessionId: 'acp', toolCall: { toolCallId: 't1', kind: 'execute', title: 'Run pnpm test', name: 'exec' }, options: [] },
};

function build(overrides: Partial<Parameters<typeof buildSubagentProviderOptions>[0]> = {}) {
  const emit = vi.fn();
  const nativeApprovals = new NativeApprovalService();
  const options = buildSubagentProviderOptions({
    sessionId: 'arch-run-1-a',
    turnId: 'turn-1',
    runId: 'run-1',
    abortSignal: new AbortController().signal,
    trackingEmit: emit,
    sessions: {} as never,
    nativeApprovals,
    ...overrides,
  });
  return { emit, nativeApprovals, options };
}

afterEach(() => { vi.useRealTimers(); });

describe('buildSubagentProviderOptions native approvals', () => {
  it('emits a Devin permission for the branch session, persists it and resolves the ACP request on confirm', async () => {
    const hitlRequests = {
      create: vi.fn(async (input: { id: string }) => ({ id: input.id, revision: 3 })),
      resolve: vi.fn(async () => true),
    };
    const { emit, nativeApprovals, options } = build({ hitlRequests: hitlRequests as never });
    const decision = options.onNativeApprovalRequested!(devinRequest);
    await vi.waitFor(() => expect(emit).toHaveBeenCalledWith('tool:confirmation_required', expect.anything()));
    const request = emit.mock.calls[0]![1] as ToolConfirmationRequest;
    expect(request).toMatchObject({ sessionId: 'arch-run-1-a', turnId: 'turn-1', toolName: 'codex_native:devin.session.request_permission' });
    expect(hitlRequests.create).toHaveBeenCalledWith(expect.objectContaining({ id: request.requestId, sessionId: 'arch-run-1-a', runId: 'run-1' }));
    expect(nativeApprovals.getPending('arch-run-1-a')).toHaveLength(1);
    await expect(nativeApprovals.resolve(request.requestId, 'arch-run-1-a', 'accept')).resolves.toBe(true);
    await expect(decision).resolves.toBe('accept');
    expect(hitlRequests.resolve).toHaveBeenCalledWith(request.requestId, 3, 'approved', undefined);
  });

  it('declines when the human declines (no auto-approve)', async () => {
    const { emit, nativeApprovals, options } = build();
    const decision = options.onNativeApprovalRequested!(devinRequest);
    await vi.waitFor(() => expect(emit).toHaveBeenCalled());
    const request = emit.mock.calls[0]![1] as ToolConfirmationRequest;
    await nativeApprovals.resolve(request.requestId, 'arch-run-1-a', 'decline');
    await expect(decision).resolves.toBe('decline');
  });

  it('holds a manual budget wait for the whole approval and releases it afterwards', async () => {
    const release = vi.fn();
    const begin = vi.fn(() => release);
    const { emit, nativeApprovals, options } = build({ beginManualToolWait: begin });
    const decision = options.onNativeApprovalRequested!(devinRequest);
    await vi.waitFor(() => expect(emit).toHaveBeenCalled());
    expect(begin).toHaveBeenCalledTimes(1);
    expect(release).not.toHaveBeenCalled();
    await nativeApprovals.resolve((emit.mock.calls[0]![1] as ToolConfirmationRequest).requestId, 'arch-run-1-a', 'accept');
    await decision;
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('keeps the idle budget from expiring while a native approval is pending', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const expired = vi.fn((error: Error) => controller.abort(error));
    const budget = createSubagentExecutionBudget({ timeoutMs: 300_000, mode: 'idle', signal: controller.signal, isCurrent: () => true, onExpired: expired });
    budget.start();
    const { emit, nativeApprovals, options } = build({ beginManualToolWait: budget.beginManualToolWait });
    const decision = options.onNativeApprovalRequested!(devinRequest);
    await vi.waitFor(() => expect(emit).toHaveBeenCalled());
    await vi.advanceTimersByTimeAsync(900_000);
    expect(expired).not.toHaveBeenCalled();
    await nativeApprovals.resolve((emit.mock.calls[0]![1] as ToolConfirmationRequest).requestId, 'arch-run-1-a', 'accept');
    await expect(decision).resolves.toBe('accept');
    await vi.advanceTimersByTimeAsync(299_999);
    expect(expired).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(expired).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['no tracking emit', { trackingEmit: undefined }],
    ['no approval service', { nativeApprovals: undefined }],
  ])('fails fast naming the pending permission when there is %s', async (_name, overrides) => {
    const onUnavailable = vi.fn();
    const { options } = build({ ...overrides, onNativeApprovalUnavailable: onUnavailable });
    await expect(options.onNativeApprovalRequested!(devinRequest)).rejects.toThrow(/NATIVE_APPROVAL_UNAVAILABLE.*devin\.session\.request_permission.*Run pnpm test.*arch-run-1-a/);
    expect(onUnavailable).toHaveBeenCalledTimes(1);
  });
});