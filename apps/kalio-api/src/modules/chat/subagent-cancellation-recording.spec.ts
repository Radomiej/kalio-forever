import { describe, expect, it } from 'vitest';
import { ActiveSubagentRunRegistry } from './subagent-runtime.support';
import { createHostCancellationRecordingScope, readHostCancellationRecordingPermit } from './host-cancellation-recording-scope';

const identity = { runId: 'run', sessionId: 'child', turnId: 'turn', promptMessageId: 'prompt' };
function fixture(failLease = false) {
  const registry = new ActiveSubagentRunRegistry();
  const controller = new AbortController();
  const release = registry.register({ childSessionId: 'child', parentSessionId: 'parent', historySessionId: 'history',
    vfsSessionId: 'workspace', turnId: 'turn', promptMessageId: 'prompt', controller });
  const handle = registry.bindCancellationRecording('child', controller, (executionIdentity, executionSignal) =>
    createHostCancellationRecordingScope({ executionIdentity, executionSignal, identity, maxPersistenceLeaseMs: 1000,
      acquirePersistenceLease: () => {
        if (failLease) throw new Error('private failure');
        return { signal: new AbortController().signal, expiresAt: Date.now() + 500 };
      } }));
  return { registry, controller, release, handle };
}

describe('subagent-owned cancellation recording', () => {
  it('aborts every matched child despite one lease failure and drains all of them', async () => {
    const f = fixture(true);
    const second = new AbortController();
    const releaseSecond = f.registry.register({ childSessionId: 'second', parentSessionId: 'parent', historySessionId: 'history',
      vfsSessionId: 'workspace', turnId: 'other-turn', controller: second });
    const unrelated = new AbortController();
    const releaseUnrelated = f.registry.register({ childSessionId: 'unrelated', parentSessionId: 'elsewhere', historySessionId: 'elsewhere',
      vfsSessionId: 'elsewhere', turnId: 'elsewhere', controller: unrelated });
    let settled = false;
    const failed = expect(f.registry.stopAndDrainSessions(['parent'])).rejects.toThrow('HOST_CANCELLATION_RECORDING_LEASE')
      .then(() => { settled = true; });
    expect(f.controller.signal.aborted).toBe(true);
    expect(second.signal.aborted).toBe(true);
    expect(unrelated.signal.aborted).toBe(false);
    f.release();
    await Promise.resolve();
    expect(settled).toBe(false);
    releaseSecond();
    await failed;
    releaseUnrelated();
  });

  it('rejects a foreign controller without invoking the scope factory', () => {
    const f = fixture();
    let calls = 0;
    expect(f.registry.bindCancellationRecording('child', new AbortController(), () => {
      calls++;
      throw new Error('must not create foreign scope');
    })).toBeNull();
    expect(calls).toBe(0);
    f.release();
  });

  it('uses the actual private run, stops through parent ownership and revokes on release', async () => {
    const f = fixture();
    expect(f.handle).not.toBeNull();
    const recorder = {};
    await f.handle!.registerAdmission({ identity, callId: 'call', toolName: 'read', args: {} }, recorder, Promise.resolve());
    const stop = f.registry.stopAndDrainSessions(['parent']);
    expect(f.controller.signal.aborted).toBe(true);
    const permit = f.handle!.permitFor('call', recorder)!;
    expect(readHostCancellationRecordingPermit(permit, identity, 'call', recorder).signal.aborted).toBe(false);
    let completed = false;
    void stop.then(() => { completed = true; });
    await Promise.resolve();
    expect(completed).toBe(false);
    f.release();
    await stop;
    expect(() => readHostCancellationRecordingPermit(permit, identity, 'call', recorder)).toThrow('HOST_CANCELLATION_RECORDING_CLOSED');
  });

  it('aborts and awaits the child even when the recording lease fails', async () => {
    const f = fixture(true);
    let completed = false;
    const failed = expect(f.registry.stopAndDrainSessions(['workspace'])).rejects.toThrow('HOST_CANCELLATION_RECORDING_LEASE')
      .then(() => { completed = true; });
    expect(f.controller.signal.aborted).toBe(true);
    await Promise.resolve();
    expect(completed).toBe(false);
    f.release();
    await failed;
  });
});
