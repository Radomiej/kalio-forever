import { afterEach, describe, expect, it, vi } from 'vitest';
import { ActiveSubagentRunRegistry } from './subagent-runtime.support';
import { bindObservedSubagentCancellation } from './subagent-cancellation-binding';
import { readHostCancellationRecordingPermit } from './host-cancellation-recording-scope';

const identity = { runId: 'journal', sessionId: 'child', turnId: 'turn', promptMessageId: 'prompt' };
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
describe('observed subagent cancellation production binding', () => {
  it('issues a bounded independent signal only from actual parent Stop', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const registry = new ActiveSubagentRunRegistry();
    const controller = new AbortController();
    const release = registry.register({ childSessionId: 'child', parentSessionId: 'parent', historySessionId: 'parent',
      vfsSessionId: 'parent', turnId: 'turn', promptMessageId: 'prompt', controller });
    const handle = bindObservedSubagentCancellation(registry, 'child', controller, identity);
    const recorder = {};
    await handle.registerAdmission({ identity, callId: 'call', toolName: 'read', args: {} }, recorder, Promise.resolve());
    expect(handle.permitFor('call', recorder)).toBeNull();
    const stopping = registry.stopAndDrainSessions(['parent']);
    const permit = handle.permitFor('call', recorder);
    expect(permit).not.toBeNull();
    const lease = readHostCancellationRecordingPermit(permit!, identity, 'call', recorder);
    expect(controller.signal.aborted).toBe(true);
    expect(lease.signal.aborted).toBe(false);
    expect(lease.signal).not.toBe(controller.signal);
    expect(lease.expiresAt).toBe(6000);
    release();
    await stopping;
    expect(lease.signal.aborted).toBe(true);
  });

  it('keeps a valid bounded lease when acquisition crosses a wall-clock millisecond', async () => {
    const registry = new ActiveSubagentRunRegistry();
    const controller = new AbortController();
    const release = registry.register({ childSessionId: 'child', parentSessionId: 'parent', historySessionId: 'parent',
      vfsSessionId: 'parent', turnId: 'turn', promptMessageId: 'prompt', controller });
    const handle = bindObservedSubagentCancellation(registry, 'child', controller, identity);
    const recorder = {};
    await handle.registerAdmission({ identity, callId: 'call', toolName: 'read', args: {} }, recorder, Promise.resolve());
    const clock = vi.spyOn(Date, 'now').mockReturnValueOnce(1000).mockReturnValue(1001);
    const stopping = registry.stopAndDrainSessions(['parent']);
    const settled = stopping.then(() => undefined, error => error as unknown);
    try {
      expect(controller.signal.aborted).toBe(true);
      const permit = handle.permitFor('call', recorder);
      expect(permit).not.toBeNull();
      const lease = readHostCancellationRecordingPermit(permit!, identity, 'call', recorder);
      expect(lease.expiresAt).toBe(6000);
      expect(lease.signal.aborted).toBe(false);
      expect(lease.signal).not.toBe(controller.signal);
      expect(handle.permitFor('call', {})).toBeNull();
      expect(() => readHostCancellationRecordingPermit(permit!, { ...identity, sessionId: 'foreign' }, 'call', recorder))
        .toThrow('HOST_CANCELLATION_RECORDING_INVALID');
      clock.mockReturnValue(6000);
      expect(handle.permitFor('call', recorder)).toBeNull();
      expect(lease.signal.aborted).toBe(true);
      expect(() => readHostCancellationRecordingPermit(permit!, identity, 'call', recorder))
        .toThrow('HOST_CANCELLATION_RECORDING_EXPIRED');
    } finally {
      release();
      expect(await settled).toBeUndefined();
    }
  });
  it('rejects absent active execution and cross-session journal', () => {
    const registry = new ActiveSubagentRunRegistry();
    expect(() => bindObservedSubagentCancellation(registry, 'child', new AbortController(), identity)).toThrow('HOST_CANCELLATION_BINDING_INVALID');
    expect(() => bindObservedSubagentCancellation(registry, 'foreign', new AbortController(), identity)).toThrow('HOST_CANCELLATION_BINDING_INVALID');
  });
});
