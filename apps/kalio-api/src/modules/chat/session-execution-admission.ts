import { ConflictException } from '@nestjs/common';
import type { createHostCancellationRecordingScope, HostCancellationLifecycleHandle } from './host-cancellation-recording-scope';

/** Always fulfilled before action; errors include recording, queue cleanup and finalization. */
export interface StopPhaseOutcome { errors: readonly unknown[] }
export interface StopReleaseFailure { error: unknown }
export interface SessionStopLease {
  ready: Promise<StopPhaseOutcome>;
  /** Release acknowledgement only; never rejects. Use wait() for the full Stop result. */
  completion: Promise<void>;
  wait(): Promise<void>;
  release(failure?: StopReleaseFailure): void;
}

export interface SessionExecutionReservation {
  turnId: string;
  controller: AbortController;
  done: Promise<void>;
  seeded?: boolean;
}

export interface SessionContinuationAdmission {
  capture(): number;
  abort(sessionId: string): void;
  run(sessionId: string, turnId: string, worker: (controller: AbortController) => Promise<boolean>, version?: number): Promise<boolean>;
}

export class SessionExecutionAdmission {
  private readonly reservations = new Map<string, SessionExecutionReservation>();
  private readonly completions = new WeakMap<SessionExecutionReservation, () => void>();
  private readonly cancellationRecording = new WeakMap<SessionExecutionReservation, HostCancellationLifecycleHandle>();
  private readonly stops = new Map<string, SessionStopLease>();
  private readonly stoppedVersions = new Map<string, number>();
  private version = 0;

  capture(): number { return this.version; }
  wasStopped(sessionId: string, version: number): boolean { return (this.stoppedVersions.get(sessionId) ?? 0) > version; }
  get(sessionId: string): SessionExecutionReservation | undefined { return this.reservations.get(sessionId); }
  has(sessionId: string): boolean { return this.reservations.has(sessionId); }
  keys(): IterableIterator<string> { return this.reservations.keys(); }
  isStopping(sessionId: string): boolean { return this.stops.has(sessionId); }
  waitForStop(sessionId: string): Promise<void> | undefined { return this.stops.get(sessionId)?.wait(); }

  assertStopLeaseAvailable(sessionId: string): void {
    if (this.stops.has(sessionId)) throw new ConflictException({ code: 'SESSION_STOP_IN_PROGRESS', message: 'SESSION_STOP_IN_PROGRESS' });
  }

  bindCancellationRecording(sessionId: string, reservation: SessionExecutionReservation,
    scope: ReturnType<typeof createHostCancellationRecordingScope>): boolean {
    if (this.reservations.get(sessionId) !== reservation || this.stops.has(sessionId)
      || reservation.controller.signal.aborted || this.cancellationRecording.has(reservation)) return false;
    const handle = scope.lookup(reservation, reservation.controller.signal);
    if (!handle) return false;
    this.cancellationRecording.set(reservation, handle);
    return true;
  }

  reserve(sessionId: string, turnId: string, options?: { seeded?: boolean; version?: number }): SessionExecutionReservation | null {
    if (this.reservations.has(sessionId) || this.stops.has(sessionId)
      || (options?.version !== undefined && this.wasStopped(sessionId, options.version))) return null;
    let complete!: () => void;
    const done = new Promise<void>((resolve) => { complete = resolve; });
    const reservation = { turnId, controller: new AbortController(), done, ...(options?.seeded ? { seeded: true } : {}) };
    this.completions.set(reservation, complete);
    this.reservations.set(sessionId, reservation);
    return reservation;
  }

  release(sessionId: string, reservation: SessionExecutionReservation): void {
    if (this.reservations.get(sessionId) !== reservation) return;
    this.cancellationRecording.get(reservation)?.close();
    this.cancellationRecording.delete(reservation);
    this.reservations.delete(sessionId);
    this.completions.get(reservation)?.();
    this.completions.delete(reservation);
  }

  async stopAndDrain(sessionId: string, cleanup?: () => Promise<void>, finalize?: () => Promise<void>): Promise<void> {
    const existingStop = this.stops.get(sessionId);
    const lease = existingStop ?? this.acquireStopLease(sessionId, Promise.resolve(), cleanup, finalize);
    if (!existingStop) { await lease.ready; lease.release(); }
    await lease.wait();
  }

  acquireStopLease(sessionId: string, ownersSettled: Promise<void>, cleanup?: () => Promise<void>,
    finalize?: () => Promise<void>): SessionStopLease {
    this.assertStopLeaseAvailable(sessionId);
    this.stoppedVersions.set(sessionId, ++this.version);
    const reservation = this.reservations.get(sessionId);
    const errors: unknown[] = [];
    let acknowledgeRelease!: () => void;
    const released = new Promise<void>(resolve => { acknowledgeRelease = resolve; });
    let releaseFailure: StopReleaseFailure | undefined;
    let wasReleased = false;
    const release = (failure?: StopReleaseFailure) => {
      if (wasReleased) return;
      wasReleased = true;
      releaseFailure = failure === undefined ? undefined : { error: failure.error };
      acknowledgeRelease();
    };
    const capture = async (operation?: () => Promise<void>) => {
      try { await operation?.(); } catch (error) { errors.push(error); }
    };
    // Observe a rejecting owner barrier immediately, before worker cleanup yields.
    const owners = ownersSettled.then(() => undefined, error => { errors.push(error); });
    const ready = Promise.resolve().then(async (): Promise<StopPhaseOutcome> => {
      await capture(cleanup);
      if (reservation?.seeded) this.release(sessionId, reservation);
      await reservation?.done;
      await capture(cleanup);
      await owners;
      await capture(finalize);
      return { errors };
    }).catch((error: unknown): StopPhaseOutcome => { errors.push(error); return { errors }; });
    const completion = Promise.all([ready, released]).then(() => {
      if (this.stops.get(sessionId) === lease) this.stops.delete(sessionId);
    });
    const wait = async (): Promise<void> => {
      await completion;
      // A coordinator failure already includes local phase failures. Preserve even falsy throws.
      if (releaseFailure !== undefined) throw releaseFailure.error;
      if (errors.length === 1) throw errors[0];
      if (errors.length > 1) throw new AggregateError(errors, errors.map(String).join('; '));
    };
    const lease: SessionStopLease = { ready, completion, wait, release };
    this.stops.set(sessionId, lease);
    try { if (reservation) this.cancellationRecording.get(reservation)?.stop(); }
    catch (error) { errors.push(error); }
    reservation?.controller.abort();
    return lease;
  }
}
