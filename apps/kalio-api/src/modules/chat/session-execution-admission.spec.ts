import { describe, expect, it } from 'vitest';
import { SessionExecutionAdmission } from './session-execution-admission';
import { createHostCancellationRecordingScope, readHostCancellationRecordingPermit } from './host-cancellation-recording-scope';

describe('SessionExecutionAdmission', () => {
  it.each([undefined, null, false, 0, ''])('keeps release ACK fulfilled but rejects semantic wait for falsy failure %s', async error => {
    const owner = new SessionExecutionAdmission();
    const lease = owner.acquireStopLease('session', Promise.resolve());
    await lease.ready;
    const waiting = owner.waitForStop('session')!.then(() => ({ ok: true }), reason => ({ ok: false, reason: reason as unknown }));
    const joined = owner.stopAndDrain('session').then(() => ({ ok: true }), reason => ({ ok: false, reason: reason as unknown }));
    lease.release({ error });
    lease.release(); // A later successful release must not erase the first failure.
    await expect(lease.completion).resolves.toBeUndefined();
    expect(await waiting).toEqual({ ok: false, reason: error });
    expect(await joined).toEqual({ ok: false, reason: error });
    await expect(lease.wait()).rejects.toBe(error);
    expect(owner.reserve('session', 'fresh')).not.toBeNull();
  });

  it('propagates a local finalizer failure to waiters without rejecting release ACK', async () => {
    const owner = new SessionExecutionAdmission(); const failure = new Error('local finalizer');
    const lease = owner.acquireStopLease('session', Promise.resolve(), undefined, async () => { throw failure; });
    const waiting = owner.waitForStop('session')!.then(() => null, (error: unknown) => ({ error }));
    expect((await lease.ready).errors).toEqual([failure]);
    lease.release();
    await expect(lease.completion).resolves.toBeUndefined();
    expect(await waiting).toEqual({ error: failure });
    await expect(lease.wait()).rejects.toBe(failure);
  });

  it('keeps the first successful release when another caller subsequently reports failure', async () => {
    const owner = new SessionExecutionAdmission();
    const lease = owner.acquireStopLease('session', Promise.resolve());
    await lease.ready;
    lease.release(); lease.release({ error: new Error('late failure') });
    await expect(lease.wait()).resolves.toBeUndefined();
  });

  it('retains a synchronous fence through owner drain, finalization and action release', async () => {
    const owner = new SessionExecutionAdmission();
    const slot = owner.reserve('session', 'turn')!;
    let settleOwners!: () => void;
    const owners = new Promise<void>(resolve => { settleOwners = resolve; });
    let finalized = false;
    const lease = owner.acquireStopLease('session', owners, undefined, async () => { finalized = true; });
    let completed = false;
    void lease.completion.then(() => { completed = true; });
    expect(slot.controller.signal.aborted).toBe(true);
    expect(owner.reserve('session', 'next')).toBeNull();
    owner.release('session', slot);
    await Promise.resolve();
    expect(finalized).toBe(false);
    settleOwners();
    expect(await lease.ready).toEqual({ errors: [] });
    expect(finalized).toBe(true);
    expect(completed).toBe(false);
    expect(owner.reserve('session', 'action-gap')).toBeNull();
    lease.release();
    await lease.completion;
    expect(completed).toBe(true);
    expect(owner.reserve('session', 'next')).not.toBeNull();
  });

  it('reports every cleanup/finalizer failure while retaining the fence', async () => {
    const owner = new SessionExecutionAdmission();
    const cleanup = new Error('cleanup'); const finalizer = new Error('finalizer');
    const lease = owner.acquireStopLease('session', Promise.resolve(),
      async () => { throw cleanup; }, async () => { throw finalizer; });
    expect((await lease.ready).errors).toEqual([cleanup, cleanup, finalizer]);
    expect(owner.reserve('session', 'next')).toBeNull();
    lease.release(); await lease.completion;
    expect(owner.reserve('session', 'next')).not.toBeNull();
  });

  it('fulfills ready with a recording failure before action while retaining admission', async () => {
    const owner = new SessionExecutionAdmission(); const slot = owner.reserve('session', 'turn')!;
    const scope = createHostCancellationRecordingScope({ executionIdentity: slot, executionSignal: slot.controller.signal,
      identity: { runId: 'run', sessionId: 'session', turnId: 'turn', promptMessageId: 'prompt' },
      maxPersistenceLeaseMs: 1000, acquirePersistenceLease: () => { throw new Error('recording lease unavailable'); } });
    owner.bindCancellationRecording('session', slot, scope);
    const lease = owner.acquireStopLease('session', Promise.resolve());
    owner.release('session', slot);
    expect((await lease.ready).errors.map(String).join(';')).toContain('HOST_CANCELLATION_RECORDING_LEASE');
    expect(owner.reserve('session', 'gap')).toBeNull();
    lease.release(); await lease.completion;
    expect(owner.reserve('session', 'next')).not.toBeNull();
  });

  it('rejects a retained acquisition behind a weaker standalone stop', async () => {
    const owner = new SessionExecutionAdmission();
    const slot = owner.reserve('session', 'turn')!;
    const standalone = owner.stopAndDrain('session');
    expect(() => owner.acquireStopLease('session', Promise.resolve())).toThrow('SESSION_STOP_IN_PROGRESS');
    owner.release('session', slot);
    await standalone;
  });
  it('binds cancellation recording to the exact reservation and revokes it on release', async () => {
    const owner = new SessionExecutionAdmission();
    const slot = owner.reserve('session', 'turn')!;
    const identity = { runId: 'run', sessionId: 'session', turnId: 'turn', promptMessageId: 'prompt' };
    const recorder = {};
    const scope = createHostCancellationRecordingScope({ executionIdentity: slot, executionSignal: slot.controller.signal,
      identity, maxPersistenceLeaseMs: 1000, acquirePersistenceLease: () => ({ signal: new AbortController().signal, expiresAt: Date.now() + 500 }) });
    const handle = scope.lookup(slot, slot.controller.signal)!;
    expect(owner.bindCancellationRecording('other', slot, scope)).toBe(false);
    expect(owner.bindCancellationRecording('session', slot, scope)).toBe(true);
    await handle.registerAdmission({ identity, callId: 'call', toolName: 'read', args: {} }, recorder, Promise.resolve());
    const stopping = owner.stopAndDrain('session');
    expect(slot.controller.signal.aborted).toBe(true);
    const permit = handle.permitFor('call', recorder)!;
    expect(readHostCancellationRecordingPermit(permit, identity, 'call', recorder).signal.aborted).toBe(false);
    owner.release('session', slot);
    await stopping;
    expect(() => readHostCancellationRecordingPermit(permit, identity, 'call', recorder)).toThrow('HOST_CANCELLATION_RECORDING_CLOSED');
  });

  it('still aborts and drains the worker when cancellation lease acquisition fails', async () => {
    const owner = new SessionExecutionAdmission();
    const slot = owner.reserve('session', 'turn')!;
    const scope = createHostCancellationRecordingScope({ executionIdentity: slot, executionSignal: slot.controller.signal,
      identity: { runId: 'run', sessionId: 'session', turnId: 'turn', promptMessageId: 'prompt' },
      maxPersistenceLeaseMs: 1000, acquirePersistenceLease: () => { throw new Error('private lease failure'); } });
    expect(owner.bindCancellationRecording('session', slot, scope)).toBe(true);
    let settled = false;
    const stopped = owner.stopAndDrain('session');
    const rejected = expect(stopped).rejects.toThrow('HOST_CANCELLATION_RECORDING_LEASE').then(() => { settled = true; });
    expect(slot.controller.signal.aborted).toBe(true);
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(owner.reserve('session', 'next')).toBeNull();
    owner.release('session', slot);
    await rejected;
    expect(owner.reserve('session', 'next')).not.toBeNull();
  });

  it('reserves one turn synchronously before continuation work can await', () => {
    const owner = new SessionExecutionAdmission();
    const resume = owner.reserve('session', 'original-turn');
    expect(resume?.turnId).toBe('original-turn');
    expect(owner.reserve('session', 'follow-up')).toBeNull();
    expect(owner.reserve('other-session', 'independent')).not.toBeNull();
  });

  it('cancels before controller consumers run and fences admission until cleanup settles', async () => {
    const owner = new SessionExecutionAdmission();
    const resume = owner.reserve('session', 'original-turn');
    expect(resume).not.toBeNull();
    if (!resume) return;
    let drained = false;
    const stop = owner.stopAndDrain('session').then(() => { drained = true; });
    expect(resume.controller.signal.aborted).toBe(true);
    expect(owner.reserve('session', 'follow-up')).toBeNull();
    await Promise.resolve();
    expect(drained).toBe(false);
    owner.release('session', resume);
    expect(owner.reserve('session', 'too-early')).toBeNull();
    await stop;
    expect(owner.reserve('session', 'follow-up')).not.toBeNull();
  });

  it('does not release another reservation through a stale cleanup callback', () => {
    const owner = new SessionExecutionAdmission();
    const old = owner.reserve('session', 'old');
    expect(old).not.toBeNull();
    if (!old) return;
    owner.release('session', old);
    const current = owner.reserve('session', 'current');
    expect(current).not.toBeNull();
    owner.release('session', old);
    expect(owner.reserve('session', 'overlap')).toBeNull();
  });

  it('keeps concurrent Stop requests behind the same cleanup barrier', async () => {
    const owner = new SessionExecutionAdmission();
    const reservation = owner.reserve('session', 'turn');
    expect(reservation).not.toBeNull();
    if (!reservation) return;
    const first = owner.stopAndDrain('session');
    const second = owner.stopAndDrain('session');
    expect(owner.reserve('other-session', 'independent')).not.toBeNull();
    expect(owner.reserve('session', 'overlap')).toBeNull();
    owner.release('session', reservation);
    await Promise.all([first, second]);
    expect(owner.reserve('session', 'next')).not.toBeNull();
  });

  it('fences idle sessions through queue cleanup and rejects metadata read before Stop', async () => {
    const owner = new SessionExecutionAdmission();
    const version = owner.capture();
    let finish!: () => void;
    let second!: () => void;
    const secondCleanup = new Promise<void>(resolve => { second = resolve; });
    let calls = 0;
    const stop = owner.stopAndDrain('session', () => new Promise<void>((resolve) => {
      finish = resolve;
      if (++calls === 2) second();
    }));
    expect(owner.reserve('session', 'overlap')).toBeNull();
    await Promise.resolve();
    finish();
    await secondCleanup;
    finish();
    await stop;
    expect(owner.reserve('session', 'stale', { version })).toBeNull();
    expect(owner.reserve('other-session', 'valid', { version })).not.toBeNull();
    expect(owner.reserve('session', 'fresh', { version: owner.capture() })).not.toBeNull();
  });

  it('retains the cleanup barrier even when durable queue cleanup rejects', async () => {
    const owner = new SessionExecutionAdmission();
    const slot = owner.reserve('session', 'turn')!;
    let drained = false;
    const stop = owner.stopAndDrain('session', async () => { throw new Error('cleanup failed'); });
    const failure = expect(stop).rejects.toThrow('cleanup failed').then(() => { drained = true; });
    await Promise.resolve();
    await Promise.resolve();
    expect(drained).toBe(false);
    expect(owner.reserve('session', 'overlap')).toBeNull();
    owner.release('session', slot);
    await failure;
    expect(owner.reserve('session', 'next')).not.toBeNull();
  });
});
