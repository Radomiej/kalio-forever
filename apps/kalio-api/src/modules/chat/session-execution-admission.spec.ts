import { describe, expect, it } from 'vitest';
import { SessionExecutionAdmission } from './session-execution-admission';

describe('SessionExecutionAdmission', () => {
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
    const stop = owner.stopAndDrain('session', () => new Promise<void>((resolve) => { finish = resolve; }));
    expect(owner.reserve('session', 'overlap')).toBeNull();
    await Promise.resolve();
    finish();
    await Promise.resolve();
    await Promise.resolve();
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
