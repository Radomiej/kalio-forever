import type { ArchitectureRun } from '@kalio/types';
import { describe, expect, it, vi } from 'vitest';
import type { ArchitectureGoalLifecycleService } from './architecture-goal-lifecycle.service';
import type { ArchitectureGoalAuditService } from './architecture-goal-audit.service';
import { createGoalPacket, appendGoalSource } from './architecture-goal-source';
import type { ArchitectureGoalState } from './architecture-goal.repository';
import { ArchitectureGoalRunResumeService } from './architecture-goal-run-resume.service';

const original = { sessionId: 'host', messageId: 'prompt', turnId: 'turn', content: '  Canonical original\n', createdAt: 5 };
const update = { ...original, messageId: 'update', turnId: 'update-turn', content: 'Persisted update', createdAt: 6 };
const locator = { sessionId: update.sessionId, messageId: update.messageId, turnId: update.turnId };
const run = (): ArchitectureRun => ({ id: 'run', rootSessionId: 'internal-root', schemaId: 'schema',
  prompt: 'Stale model prompt', executionMode: 'session_branches', status: 'running', createdAt: 10, updatedAt: 10,
  context: { goalProtocol: 1, goalSource: { sessionId: 'forged' }, goalPacket: { forged: true } },
  goalPacket: createGoalPacket(original) });
const state = (): ArchitectureGoalState => ({ runId: 'run', rootSessionId: 'internal-root', stateRevision: 2,
  evidenceInventory: null, completionAuthorization: null,
  createdAt: 10, updatedAt: 11, packet: appendGoalSource(createGoalPacket(original), update) });
function fixture() {
  let saved = state();
  const hydrate = vi.fn<ArchitectureGoalLifecycleService['hydrate']>(() => structuredClone(saved));
  const append = vi.fn<ArchitectureGoalLifecycleService['append']>(async (_runId, _root, _source, expected) => {
    if (expected !== saved.stateRevision) throw new Error('GOAL_STATE_CONFLICT');
    return structuredClone(saved); // Identical persisted update: no revision increment.
  });
  const persistRequired = vi.fn<ArchitectureGoalAuditService['persistRequired']>(async () => undefined);
  return { hydrate, append, persistRequired, get saved() { return saved; }, set saved(value) { saved = value; },
    service: new ArchitectureGoalRunResumeService({ hydrate, append }, { persistRequired }) };
}

describe('ArchitectureGoalRunResumeService', () => {
  it('hydrates latest state rather than stale memory or forged context and preserves original prompt', async () => {
    const { service, hydrate, append, persistRequired, saved } = fixture();
    const input = run();
    const before = structuredClone(input);
    const resumed = await service.resume(input, {});
    expect(hydrate).toHaveBeenCalledExactlyOnceWith('run', 'internal-root', true);
    expect(append).not.toHaveBeenCalled();
    expect(persistRequired).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: 'run', rootSessionId: 'internal-root' }), saved);
    expect(resumed.goalPacket).toEqual(saved.packet);
    expect(resumed.prompt).toBe(original.content);
    expect(resumed.context).toEqual(input.context);
    expect(resumed.context).not.toBe(input.context);
    expect(input).toEqual(before);
    resumed.goalPacket!.original.content = 'Mutated result';
    expect(input).toEqual(before);
    expect(saved.packet.original.content).toBe(original.content);
  });
  it('returns an isolated unchanged legacy clone without dependency calls', async () => {
    const { service, hydrate, append, persistRequired } = fixture();
    const legacy = run();
    delete legacy.goalPacket;
    legacy.context = { nested: { value: 'unchanged' } };
    const resumed = await service.resume(legacy, { input: 'Legacy handled by parent' });
    expect(resumed).toEqual(legacy);
    expect(resumed).not.toBe(legacy);
    expect(resumed.context).not.toBe(legacy.context);
    expect(hydrate).not.toHaveBeenCalled();
    expect(append).not.toHaveBeenCalled();
    expect(persistRequired).not.toHaveBeenCalled();
  });
  it.each([undefined, null, 0, 2, '1'])('rejects unsupported own protocol marker %j', async marker => {
    const { service, hydrate } = fixture();
    const input = run();
    input.context!['goalProtocol'] = marker;
    await expect(service.resume(input, {})).rejects.toThrow(/^GOAL_RESUME_PROTOCOL_INVALID$/);
    expect(hydrate).not.toHaveBeenCalled();
  });
  it('requires durable state for marker-only and packet-only runs, never downgrading missing state', async () => {
    const { service, hydrate } = fixture();
    hydrate.mockImplementation(() => { throw new Error('GOAL_STATE_MISSING'); });
    const markerOnly = run();
    delete markerOnly.goalPacket;
    await expect(service.resume(markerOnly, {})).rejects.toThrow(/^GOAL_RESUME_FAILED$/);
    const packetOnly = run();
    packetOnly.context = {};
    await expect(service.resume(packetOnly, {})).rejects.toThrow(/^GOAL_RESUME_FAILED$/);
    hydrate.mockReturnValue(null);
    await expect(service.resume(run(), {})).rejects.toThrow(/^GOAL_RESUME_FAILED$/);
  });
  it('rejects nonblank raw input without a persisted locator', async () => {
    const { service, append, persistRequired } = fixture();
    const input = run();
    const before = structuredClone(input);
    await expect(service.resume(input, { input: 'secret unpersisted requirement' })).rejects.toThrow(/^GOAL_RESUME_SOURCE_REQUIRED$/);
    expect(append).not.toHaveBeenCalled();
    expect(persistRequired).not.toHaveBeenCalled();
    expect(input).toEqual(before);
    await expect(service.resume(input, { input: ' \n ' })).resolves.toHaveProperty('prompt', original.content);
  });
  it.each([undefined, 0, -1, NaN, 1.5])('requires a valid expected revision for source (%j)', async expectedRevision => {
    const { service, append } = fixture();
    await expect(service.resume(run(), { source: locator, expectedRevision })).rejects.toThrow(/^GOAL_RESUME_REVISION_REQUIRED$/);
    expect(append).not.toHaveBeenCalled();
  });
  it('uses only a trusted persisted locator, ignores raw text, and keeps duplicate revision', async () => {
    const { service, append, saved } = fixture();
    const resumed = await service.resume(run(), { source: locator, expectedRevision: 2, input: 'MODEL SECRET RAW' });
    expect(append).toHaveBeenCalledExactlyOnceWith('run', 'internal-root', locator, 2);
    expect(resumed.goalPacket).toEqual(saved.packet);
    expect(resumed.goalPacket!.updates[0]!.content).toBe('Persisted update');
    expect(resumed.prompt).toBe(original.content);
    expect(JSON.stringify(resumed)).not.toContain('MODEL SECRET RAW');
  });
  it('fails a stale expected revision without audit, retry or merge', async () => {
    const { service, append, persistRequired } = fixture();
    await expect(service.resume(run(), { source: locator, expectedRevision: 1 })).rejects.toThrow(/^GOAL_RESUME_FAILED$/);
    expect(append).toHaveBeenCalledTimes(1);
    expect(persistRequired).not.toHaveBeenCalled();
  });
  it('waits for audit ACK before returning and never mutates the supplied run', async () => {
    const { service, persistRequired } = fixture();
    let ack!: () => void;
    persistRequired.mockImplementation(() => new Promise<void>(resolve => { ack = resolve; }));
    const input = run();
    const before = structuredClone(input);
    let settled = false;
    const pending = service.resume(input, {}).then(value => { settled = true; return value; });
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(input).toEqual(before);
    ack();
    expect((await pending).prompt).toBe(original.content);
    expect(input).toEqual(before);
  });
  it('supports hydrate-only retry after append succeeded but audit failed, without reappend', async () => {
    const f = fixture();
    f.append.mockImplementation(async () => {
      f.saved = { ...f.saved, stateRevision: 3, packet: appendGoalSource(f.saved.packet, { ...update, messageId: 'next', turnId: 'next-turn' }) };
      return structuredClone(f.saved);
    });
    f.persistRequired.mockRejectedValueOnce(new Error('secret driver text'));
    const input = run();
    const before = structuredClone(input);
    await expect(f.service.resume(input, { source: locator, expectedRevision: 2 })).rejects.toThrow(/^GOAL_RESUME_FAILED$/);
    expect(input).toEqual(before);
    const resumed = await f.service.resume(input, {});
    expect(resumed.goalPacket!.version).toBe(3);
    expect(f.append).toHaveBeenCalledTimes(1);
    expect(f.persistRequired).toHaveBeenCalledTimes(2);
  });
});
