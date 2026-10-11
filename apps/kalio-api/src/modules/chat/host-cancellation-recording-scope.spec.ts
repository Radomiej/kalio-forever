import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HostRuntimeToolAdmission } from '@kalio/types';
import { createHostCancellationRecordingScope, readHostCancellationRecordingPermit } from './host-cancellation-recording-scope';

afterEach(() => vi.useRealTimers());
const identity = { runId: 'run', sessionId: 'session', turnId: 'turn', promptMessageId: 'prompt' };
const admission: HostRuntimeToolAdmission = { identity, callId: 'call', toolName: 'read', args: { path: 'secret' } };
function fixture() {
  vi.useFakeTimers(); vi.setSystemTime(1000);
  const executionIdentity = {}; const execution = new AbortController(); const persistence = new AbortController(); const recorder = {};
  const acquire = vi.fn(() => ({ signal: persistence.signal, expiresAt: 1500 }));
  const scope = createHostCancellationRecordingScope({ executionIdentity, executionSignal: execution.signal, identity,
    maxPersistenceLeaseMs: 1000, acquirePersistenceLease: acquire });
  const handle = scope.lookup(executionIdentity, execution.signal)!;
  return { scope, handle, executionIdentity, execution, persistence, recorder, acquire };
}
describe('host-owned bounded cancellation recording scope', () => {
  it('requires exact active execution object and signal identity', () => {
    const f = fixture(); expect(f.scope.lookup(f.executionIdentity, f.execution.signal)).toBe(f.handle);
    expect(f.scope.lookup({}, f.execution.signal)).toBeNull();
    expect(f.scope.lookup(f.executionIdentity, new AbortController().signal)).toBeNull();
  });
  it('mints only after actual successful ACK and explicit owner Stop', async () => {
    const f = fixture(); await f.handle.registerAdmission(admission, f.recorder, Promise.resolve());
    expect(f.handle.permitFor('call', f.recorder)).toBeNull();
    f.execution.abort('generic failure'); expect(f.handle.permitFor('call', f.recorder)).toBeNull(); expect(f.acquire).not.toHaveBeenCalled();
    f.handle.stop(); const permit = f.handle.permitFor('call', f.recorder)!;
    const lease = readHostCancellationRecordingPermit(permit, identity, 'call', f.recorder);
    expect(lease.expiresAt).toBe(1500); expect(lease.signal).not.toBe(f.execution.signal); expect(lease.signal.aborted).toBe(false);
    expect(JSON.stringify(permit)).toBe('{}');
  });
  it('rejects forged, cross-call, cross-recorder and cross-turn permits', async () => {
    const f = fixture(); await f.handle.registerAdmission(admission, f.recorder, Promise.resolve()); f.handle.stop();
    const permit = f.handle.permitFor('call', f.recorder)!;
    expect(() => readHostCancellationRecordingPermit({}, identity, 'call', f.recorder)).toThrow(/^HOST_CANCELLATION_RECORDING_INVALID$/);
    expect(() => readHostCancellationRecordingPermit(permit, identity, 'other', f.recorder)).toThrow(/^HOST_CANCELLATION_RECORDING_INVALID$/);
    expect(() => readHostCancellationRecordingPermit(permit, identity, 'call', {})).toThrow(/^HOST_CANCELLATION_RECORDING_INVALID$/);
    expect(() => readHostCancellationRecordingPermit(permit, { ...identity, turnId: 'other' }, 'call', f.recorder)).toThrow(/^HOST_CANCELLATION_RECORDING_INVALID$/);
    expect(f.handle.permitFor('other', f.recorder)).toBeNull(); expect(f.handle.permitFor('call', {})).toBeNull();
  });
  it('gives no permit to a failed admission ACK', async () => {
    const f = fixture(); await expect(f.handle.registerAdmission(admission, f.recorder, Promise.reject(new Error('secret')))).rejects.toThrow(/^HOST_CANCELLATION_RECORDING_ADMISSION$/);
    f.handle.stop(); expect(f.handle.permitFor('call', f.recorder)).toBeNull();
  });
  it('fences pending ACK settlement synchronously at Stop and rejects new registrations', async () => {
    const f = fixture(); let acknowledge!: () => void;
    const pending = f.handle.registerAdmission(admission, f.recorder, new Promise<void>(resolve => { acknowledge = resolve; }));
    const expected = expect(pending).rejects.toThrow(/^HOST_CANCELLATION_RECORDING_ADMISSION$/);
    f.handle.stop(); acknowledge(); await expected;
    expect(f.handle.permitFor('call', f.recorder)).toBeNull();
    await expect(f.handle.registerAdmission(admission, f.recorder, Promise.resolve())).rejects.toThrow(/^HOST_CANCELLATION_RECORDING_CLOSED$/);
  });
  it('does not grant an ACK that was fulfilled but not observed before Stop', async () => {
    const f = fixture(); const pending = f.handle.registerAdmission(admission, f.recorder, Promise.resolve());
    const expected = expect(pending).rejects.toThrow(/^HOST_CANCELLATION_RECORDING_ADMISSION$/);
    f.handle.stop(); await expected; expect(f.handle.permitFor('call', f.recorder)).toBeNull();
  });
  it('never renews or replaces a lease on repeated Stop', async () => {
    const f = fixture(); await f.handle.registerAdmission(admission, f.recorder, Promise.resolve()); f.handle.stop();
    const permit = f.handle.permitFor('call', f.recorder); vi.setSystemTime(1200); f.handle.stop();
    expect(f.handle.permitFor('call', f.recorder)).toBe(permit); expect(f.acquire).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(300);
    expect(() => readHostCancellationRecordingPermit(permit!, identity, 'call', f.recorder)).toThrow(/^HOST_CANCELLATION_RECORDING_EXPIRED$/);
    expect(f.handle.permitFor('call', f.recorder)).toBeNull();
  });
  it('revokes held permits on expiry, close and independent persistence abort', async () => {
    for (const mode of ['expiry', 'close', 'abort']) {
      const f = fixture(); await f.handle.registerAdmission(admission, f.recorder, Promise.resolve()); f.handle.stop();
      const permit = f.handle.permitFor('call', f.recorder)!;
      const lease = readHostCancellationRecordingPermit(permit, identity, 'call', f.recorder);
      const pendingReader = new Promise<void>(resolve => lease.signal.addEventListener('abort', () => resolve(), { once: true }));
      if (mode === 'expiry') vi.advanceTimersByTime(500);
      if (mode === 'close') f.handle.close();
      if (mode === 'abort') f.persistence.abort();
      await pendingReader; expect(lease.signal.aborted).toBe(true);
      expect(() => readHostCancellationRecordingPermit(permit, identity, 'call', f.recorder)).toThrow(/^HOST_CANCELLATION_RECORDING_(EXPIRED|CLOSED|ABORTED)$/);
      expect(f.handle.permitFor('call', f.recorder)).toBeNull(); f.handle.close();
    }
  });
  it.each([NaN, Infinity, -Infinity, 999, 1000, 2001])('rejects lease expiry %s without fallback', async expiresAt => {
    const f = fixture(); f.acquire.mockReturnValue({ signal: f.persistence.signal, expiresAt });
    await f.handle.registerAdmission(admission, f.recorder, Promise.resolve());
    expect(() => f.handle.stop()).toThrow(/^HOST_CANCELLATION_RECORDING_LEASE$/);
    expect(f.handle.permitFor('call', f.recorder)).toBeNull(); f.handle.stop(); expect(f.acquire).toHaveBeenCalledTimes(1);
  });
  it.each(['same', 'aborted', 'missing', 'fake'])('rejects invalid required lease signal: %s', async mode => {
    const f = fixture();
    if (mode === 'aborted') f.persistence.abort();
    const signal = mode === 'same' ? f.execution.signal : mode === 'missing' ? undefined : mode === 'fake' ? {} : f.persistence.signal;
    f.acquire.mockReturnValue({ signal, expiresAt: 1500 } as ReturnType<typeof f.acquire>);
    await f.handle.registerAdmission(admission, f.recorder, Promise.resolve());
    expect(() => f.handle.stop()).toThrow(/^HOST_CANCELLATION_RECORDING_LEASE$/); expect(f.acquire).toHaveBeenCalledTimes(1);
  });
  it('rejects lease getters without invocation', async () => {
    const f = fixture(); let reads = 0; const lease = { signal: f.persistence.signal, expiresAt: 1500 };
    Object.defineProperty(lease, 'expiresAt', { enumerable: true, get() { reads++; return 1500; } }); f.acquire.mockReturnValue(lease);
    await f.handle.registerAdmission(admission, f.recorder, Promise.resolve());
    expect(() => f.handle.stop()).toThrow(/^HOST_CANCELLATION_RECORDING_LEASE$/); expect(reads).toBe(0);
  });
  it('closes irreversibly and rejects late registration settlement', async () => {
    const f = fixture(); let acknowledge!: () => void;
    const pending = f.handle.registerAdmission(admission, f.recorder, new Promise<void>(resolve => { acknowledge = resolve; }));
    const expected = expect(pending).rejects.toThrow(/^HOST_CANCELLATION_RECORDING_ADMISSION$/);
    f.handle.close(); acknowledge(); await expected; f.handle.stop();
    expect(f.acquire).not.toHaveBeenCalled(); expect(f.scope.lookup(f.executionIdentity, f.execution.signal)).toBeNull();
  });
  it('rejects duplicate/cross-scope admissions without replacing eligible calls', async () => {
    const f = fixture(); await f.handle.registerAdmission(admission, f.recorder, Promise.resolve());
    await expect(f.handle.registerAdmission(admission, {}, Promise.resolve())).rejects.toThrow(/^HOST_CANCELLATION_RECORDING_ADMISSION$/);
    await expect(f.handle.registerAdmission({ ...admission, identity: { ...identity, runId: 'other' } }, {}, Promise.resolve())).rejects.toThrow(/^HOST_CANCELLATION_RECORDING_INVALID$/);
    f.handle.stop(); expect(f.handle.permitFor('call', f.recorder)).not.toBeNull();
  });
  it('rejects identity/accessor/proxy boundaries without invoking them', async () => {
    const f = fixture(); let reads = 0; const supplied = { ...admission };
    Object.defineProperty(supplied, 'callId', { enumerable: true, get() { reads++; return 'call'; } });
    await expect(f.handle.registerAdmission(supplied, f.recorder, Promise.resolve())).rejects.toThrow(/^HOST_CANCELLATION_RECORDING_INVALID$/);
    const proxy = new Proxy({}, { get() { reads++; return true; } });
    expect(() => readHostCancellationRecordingPermit(proxy, identity, 'call', f.recorder)).toThrow(/^HOST_CANCELLATION_RECORDING_INVALID$/);
    expect(reads).toBe(0);
  });
  it('keeps the elapsed deadline despite a backward wall-clock shift', async () => {
    const f = fixture(); await f.handle.registerAdmission(admission, f.recorder, Promise.resolve()); f.handle.stop();
    const permit = f.handle.permitFor('call', f.recorder)!;
    const lease = readHostCancellationRecordingPermit(permit, identity, 'call', f.recorder);
    vi.setSystemTime(100); vi.advanceTimersByTime(500);
    expect(lease.signal.aborted).toBe(true);
    expect(() => readHostCancellationRecordingPermit(permit, identity, 'call', f.recorder)).toThrow(/^HOST_CANCELLATION_RECORDING_EXPIRED$/);
    f.handle.close();
  });
  it('revokes the effective signal on read after a forward clock shift', async () => {
    const f = fixture(); await f.handle.registerAdmission(admission, f.recorder, Promise.resolve()); f.handle.stop();
    const permit = f.handle.permitFor('call', f.recorder)!;
    const lease = readHostCancellationRecordingPermit(permit, identity, 'call', f.recorder);
    vi.setSystemTime(2000);
    expect(() => readHostCancellationRecordingPermit(permit, identity, 'call', f.recorder)).toThrow(/^HOST_CANCELLATION_RECORDING_EXPIRED$/);
    expect(lease.signal.aborted).toBe(true); f.handle.close();
  });
  it.each([0, -1, NaN, Infinity, 2_147_483_648])('requires explicit positive bounded maximum %s', maxPersistenceLeaseMs => {
    const f = fixture(); expect(() => createHostCancellationRecordingScope({ executionIdentity: f.executionIdentity,
      executionSignal: f.execution.signal, identity, maxPersistenceLeaseMs, acquirePersistenceLease: f.acquire })).toThrow(/^HOST_CANCELLATION_RECORDING_INVALID$/);
  });
});
