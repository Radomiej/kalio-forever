import type { ArchitectureRun } from '@kalio/types';
import { describe, expect, it, vi } from 'vitest';
import { createGoalPacket } from './architecture-goal-source';
import type { ArchitectureGoalState } from './architecture-goal.repository';
import { ArchitectureGoalRunAdmissionService } from './architecture-goal-run-admission.service';

const run = (): ArchitectureRun => ({
  id: 'run', rootSessionId: 'internal-root', schemaId: 'schema', prompt: 'Model paraphrase',
  executionMode: 'session_branches', status: 'running', createdAt: 10, updatedAt: 10,
  context: { goalProtocol: 1, parentSessionId: 'host', promptMessageId: 'user-message', parentTurnId: 'user-turn',
    goalSource: { sessionId: 'forged', messageId: 'forged', turnId: 'forged' } },
});
const state = (): ArchitectureGoalState => ({
  runId: 'run', rootSessionId: 'internal-root', stateRevision: 1, createdAt: 10, updatedAt: 10,
  evidenceInventory: null, completionAuthorization: null,
  packet: createGoalPacket({ sessionId: 'host', messageId: 'user-message', turnId: 'user-turn', content: '  Canonical secret\n', createdAt: 5 }),
});
function fixture() {
  const saved = state();
  const create = vi.fn(async () => saved);
  const persistRequired = vi.fn(async (): Promise<void> => undefined);
  return { saved, create, persistRequired, admission: new ArchitectureGoalRunAdmissionService({ create }, { persistRequired }) };
}

describe('ArchitectureGoalRunAdmissionService', () => {
  it('leaves legacy runs completely untouched without dependency calls', async () => {
    const { admission, create, persistRequired } = fixture();
    for (const context of [undefined, {}, { goalSource: 'forged' }]) {
      const input = { ...run(), context };
      const before = structuredClone(input);
      await admission.attach(input);
      expect(input).toEqual(before);
    }
    expect(create).not.toHaveBeenCalled();
    expect(persistRequired).not.toHaveBeenCalled();
  });
  it.each([undefined, null, 0, 2, '1', true])('rejects explicitly present unsupported protocol %j', async goalProtocol => {
    const { admission, create } = fixture();
    const input = run();
    input.context!['goalProtocol'] = goalProtocol;
    const before = structuredClone(input);
    await expect(admission.attach(input)).rejects.toThrow(/^GOAL_ADMISSION_PROTOCOL_INVALID$/);
    expect(create).not.toHaveBeenCalled();
    expect(input).toEqual(before);
  });
  it.each(['parentSessionId', 'promptMessageId', 'parentTurnId'])('requires trusted context identity %s before writes', async key => {
    const { admission, create } = fixture();
    const input = run();
    delete input.context![key];
    await expect(admission.attach(input)).rejects.toThrow(/^GOAL_ADMISSION_IDENTITY_INVALID$/);
    expect(create).not.toHaveBeenCalled();
    expect(input.goalPacket).toBeUndefined();
  });
  it.each(['id', 'rootSessionId', 'schemaId'] as const)('requires run identity %s', async key => {
    const { admission, create } = fixture();
    const input = run();
    input[key] = '';
    await expect(admission.attach(input)).rejects.toThrow('GOAL_ADMISSION_IDENTITY_INVALID');
    expect(create).not.toHaveBeenCalled();
  });
  it('uses only trusted keys, awaits audit ACK and attaches an isolated canonical packet', async () => {
    const { admission, create, persistRequired, saved } = fixture();
    let acknowledge!: () => void;
    persistRequired.mockImplementation(() => new Promise<void>(resolve => { acknowledge = resolve; }));
    const input = run();
    const pending = admission.attach(input);
    await Promise.resolve();
    await Promise.resolve();
    expect(create).toHaveBeenCalledExactlyOnceWith('run', 'internal-root', { sessionId: 'host', messageId: 'user-message', turnId: 'user-turn' });
    expect(persistRequired).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: 'run', rootSessionId: 'internal-root', schemaId: 'schema' }), saved);
    expect(input.goalPacket).toBeUndefined();
    expect(input.prompt).toBe('Model paraphrase');
    acknowledge();
    await pending;
    expect(input.prompt).toBe(saved.packet.original.content);
    expect(input.goalPacket).toEqual(saved.packet);
    expect(input.goalPacket).not.toBe(saved.packet);
    expect(input.goalPacket!.completionPolicy).not.toBe(saved.packet.completionPolicy);
    expect(input.goalPacket!.updates).not.toBe(saved.packet.updates);
    input.goalPacket!.original.content = 'caller mutation';
    expect(saved.packet.original.content).toBe('  Canonical secret\n');
  });
  it.each(['store', 'audit'] as const)('fails closed without attachment on %s failure, hiding raw secrets', async dependency => {
    const { admission, create, persistRequired } = fixture();
    if (dependency === 'store') create.mockRejectedValue(new Error('Canonical secret SQL'));
    else persistRequired.mockRejectedValue(new Error('Canonical secret audit'));
    const input = run();
    const before = structuredClone(input);
    await expect(admission.attach(input)).rejects.toThrow(/^GOAL_ADMISSION_FAILED$/);
    expect(input).toEqual(before);
    if (dependency === 'store') expect(persistRequired).not.toHaveBeenCalled();
  });
  it('rejects a mismatched durable source before audit and attachment', async () => {
    const { admission, saved, persistRequired } = fixture();
    saved.packet.original.messageId = 'foreign-message';
    const input = run();
    await expect(admission.attach(input)).rejects.toThrow('GOAL_ADMISSION_FAILED');
    expect(persistRequired).not.toHaveBeenCalled();
    expect(input.goalPacket).toBeUndefined();
  });
  it.each(['store', 'audit'] as const)('fails closed when the %s dependency is unavailable at runtime', async dependency => {
    const { create, persistRequired } = fixture();
    const input = run();
    const before = structuredClone(input);
    // @ts-expect-error Deliberately exercise unavailable runtime dependencies, not a valid caller contract.
    const admission = new ArchitectureGoalRunAdmissionService(dependency === 'store' ? undefined : { create }, dependency === 'audit' ? undefined : { persistRequired });
    await expect(admission.attach(input)).rejects.toThrow(/^GOAL_ADMISSION_FAILED$/);
    expect(input).toEqual(before);
  });
});
