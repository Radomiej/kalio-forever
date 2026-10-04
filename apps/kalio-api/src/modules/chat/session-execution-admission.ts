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
  private readonly stops = new Map<string, Promise<void>>();
  private readonly stoppedVersions = new Map<string, number>();
  private version = 0;

  capture(): number { return this.version; }
  wasStopped(sessionId: string, version: number): boolean { return (this.stoppedVersions.get(sessionId) ?? 0) > version; }
  get(sessionId: string): SessionExecutionReservation | undefined { return this.reservations.get(sessionId); }
  has(sessionId: string): boolean { return this.reservations.has(sessionId); }
  keys(): IterableIterator<string> { return this.reservations.keys(); }
  isStopping(sessionId: string): boolean { return this.stops.has(sessionId); }
  waitForStop(sessionId: string): Promise<void> | undefined { return this.stops.get(sessionId); }

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
    this.reservations.delete(sessionId);
    this.completions.get(reservation)?.();
    this.completions.delete(reservation);
  }

  async stopAndDrain(sessionId: string, cleanup?: () => Promise<void>, finalize?: () => Promise<void>): Promise<void> {
    const existingStop = this.stops.get(sessionId);
    if (existingStop) return existingStop;
    this.stoppedVersions.set(sessionId, ++this.version);
    const reservation = this.reservations.get(sessionId);
    const drain = Promise.resolve().then(async () => {
      let cleanupError: unknown;
      let cleanupFailed = false;
      try { await cleanup?.(); } catch (error) { cleanupError = error; cleanupFailed = true; }
      if (reservation?.seeded) this.release(sessionId, reservation);
      await reservation?.done;
      try { await cleanup?.(); } catch (error) { cleanupError = error; cleanupFailed = true; }
      try { await finalize?.(); } catch (error) { cleanupError = error; cleanupFailed = true; }
      if (cleanupFailed) throw cleanupError;
    }).finally(() => {
      if (this.stops.get(sessionId) === drain) this.stops.delete(sessionId);
    });
    this.stops.set(sessionId, drain);
    reservation?.controller.abort();
    await drain;
  }
}
