import { describe, expect, it } from 'vitest';
import { ActiveSubagentRunRegistry } from './subagent-runtime.support';
import { bindObservedSubagentCancellation } from './subagent-cancellation-binding';
import { readHostCancellationRecordingPermit } from './host-cancellation-recording-scope';

const identity = { runId: 'journal', sessionId: 'child', turnId: 'turn', promptMessageId: 'prompt' };
describe('observed subagent cancellation production binding', () => {
  it('issues a bounded independent signal only from actual parent Stop', async () => {
    const registry = new ActiveSubagentRunRegistry();
    const controller = new AbortController();
    const release = registry.register({ childSessionId: 'child', parentSessionId: 'parent', historySessionId: 'parent',
      vfsSessionId: 'parent', turnId: 'turn', promptMessageId: 'prompt', controller });
    const handle = bindObservedSubagentCancellation(registry, 'child', controller, identity);
    const recorder = {};
    await handle.registerAdmission({ identity, callId: 'call', toolName: 'read', args: {} }, recorder, Promise.resolve());
    expect(handle.permitFor('call', recorder)).toBeNull();
    const stopping = registry.stopAndDrainSessions(['parent']);
    const permit = handle.permitFor('call', recorder)!;
    const lease = readHostCancellationRecordingPermit(permit, identity, 'call', recorder);
    expect(controller.signal.aborted).toBe(true);
    expect(lease.signal.aborted).toBe(false);
    expect(lease.signal).not.toBe(controller.signal);
    expect(lease.expiresAt - Date.now()).toBeGreaterThan(0);
    expect(lease.expiresAt - Date.now()).toBeLessThanOrEqual(5000);
    release();
    await stopping;
    expect(lease.signal.aborted).toBe(true);
  });
  it('rejects absent active execution and cross-session journal', () => {
    const registry = new ActiveSubagentRunRegistry();
    expect(() => bindObservedSubagentCancellation(registry, 'child', new AbortController(), identity)).toThrow('HOST_CANCELLATION_BINDING_INVALID');
    expect(() => bindObservedSubagentCancellation(registry, 'foreign', new AbortController(), identity)).toThrow('HOST_CANCELLATION_BINDING_INVALID');
  });
});
