import { describe, expect, it, vi } from 'vitest';
import { RemoteSupervisionChatAdapter } from './remote-supervision.chat-adapter';

function harness() {
  const session = { id: 'session-1', title: 'Review', updatedAt: 10, createdAt: 1, personaId: 'persona-1',
    runtimeContext: undefined, projectId: undefined, parentSessionId: undefined };
  const row: { id: string; kind: string; status: string; sessionId: string; turnId: string; runId: string;
    toolCallId: string; revision: number; payload: Record<string, unknown>; continuation: Record<string, unknown>;
    createdAt: Date } = {
    id: 'approval-1', kind: 'tool_confirmation', status: 'pending', sessionId: 'session-1',
    turnId: 'turn-1', runId: 'run-1', toolCallId: 'call-1', revision: 2,
    payload: { toolName: 'terminal_spawn', args: { command: 'pwd' } },
    continuation: { executionState: 'pending' }, createdAt: new Date(100),
  };
  const sessions = { list: vi.fn().mockResolvedValue([session]), get: vi.fn().mockResolvedValue(session), getMessages: vi.fn().mockResolvedValue([]) };
  const active = { isActive: vi.fn().mockReturnValue(true) };
  const hitl = { listPendingForSessions: vi.fn().mockResolvedValue([row]), getById: vi.fn().mockImplementation(async () => row) };
  const dispatch = { resolveConfirmation: vi.fn().mockResolvedValue('resolved'), cancelConfirmation: vi.fn().mockResolvedValue('rejected') };
  const native = { resolve: vi.fn().mockResolvedValue(true) };
  const adapter = new RemoteSupervisionChatAdapter(sessions as never, active as never, hitl as never, dispatch as never, native as never);
  return { adapter, row, hitl, dispatch, native };
}

describe('RemoteSupervisionChatAdapter', () => {
  it('projects a pending approval with availability and SHA-256 revision/digest', async () => {
    const { adapter, hitl } = harness();
    const result = await adapter.snapshot();
    expect(hitl.listPendingForSessions).toHaveBeenCalledWith(['session-1']);
    expect(result.approvals[0]).toMatchObject({ id: 'approval-1', decisionAvailable: true, kind: 'tool_confirmation' });
    expect(result.approvals[0]?.revision).toMatch(/^[a-f0-9]{64}$/);
    expect(result.approvals[0]?.argsSha256).toMatch(/^[a-f0-9]{64}$/);
  });
  it('rejects stale fingerprints without settlement', async () => {
    const { adapter, dispatch } = harness();
    await expect(adapter.decide({ approvalId: 'approval-1', revision: 'stale', argsSha256: 'stale', decision: 'approve', deviceId: 'device-1' }))
      .resolves.toEqual({ status: 'stale' });
    expect(dispatch.resolveConfirmation).not.toHaveBeenCalled();
  });
  it('accepts only one current approval after local settlement changes its durable state', async () => {
    const { adapter, row, dispatch } = harness();
    const approval = (await adapter.snapshot()).approvals[0]!;
    const input = { approvalId: approval.id, revision: approval.revision, argsSha256: approval.argsSha256, decision: 'approve' as const, deviceId: 'device-1' };
    await expect(adapter.decide(input)).resolves.toEqual({ status: 'settled' });
    row.status = 'approved';
    await expect(adapter.decide(input)).resolves.toEqual({ status: 'stale' });
    expect(dispatch.resolveConfirmation).toHaveBeenCalledTimes(1);
  });
  it('returns stale when the existing local settlement reports a lost CAS race', async () => {
    const { adapter, dispatch } = harness();
    dispatch.resolveConfirmation.mockResolvedValueOnce('not_found');
    const approval = (await adapter.snapshot()).approvals[0]!;
    await expect(adapter.decide({ approvalId: approval.id, revision: approval.revision, argsSha256: approval.argsSha256, decision: 'approve', deviceId: 'device-1' }))
      .resolves.toEqual({ status: 'stale' });
  });
  it('settles persisted native Codex approval through the native resolver', async () => {
    const { adapter, row, native, dispatch } = harness();
    row.kind = 'raapp_native';
    row.payload = { toolName: 'codex_native:terminal', nativeApproval: true, nativeMethod: 'terminal', args: { method: 'terminal', params: {} } };
    const approval = (await adapter.snapshot()).approvals[0]!;
    expect(approval).toMatchObject({ kind: 'native_approval', decisionAvailable: true });
    await expect(adapter.decide({ approvalId: approval.id, revision: approval.revision, argsSha256: approval.argsSha256, decision: 'approve', deviceId: 'device-1' }))
      .resolves.toEqual({ status: 'settled' });
    expect(native.resolve).toHaveBeenCalledWith('approval-1', 'session-1', 'accept', 'Remote device device-1');
    expect(dispatch.resolveConfirmation).not.toHaveBeenCalled();
  });
});
