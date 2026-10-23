import { ConflictException, Injectable } from '@nestjs/common';
import { PerKeyMutex } from './per-key-mutex';

/** Shared by profile mutation and reservation; never surrounds a worker or drain. */
@Injectable()
export class SessionProfileAdmissionService {
  private readonly mutex = new PerKeyMutex();
  private readonly pending = new Map<string, number>();
  private readonly mutations = new Map<string, Set<{ stopped: boolean }>>();
  private readonly stops = new Map<string, number>();

  async runExclusive<T>(id: string, work: () => Promise<T>): Promise<T> {
    this.pending.set(id, (this.pending.get(id) ?? 0) + 1);
    try { return await this.mutex.runExclusive(id, work); }
    finally {
      const remaining = this.pending.get(id)! - 1;
      if (remaining) this.pending.set(id, remaining);
      else this.pending.delete(id);
    }
  }

  tryRunExclusive<T>(id: string, work: () => T): T {
    if (this.pending.has(id)) throw new ConflictException('SESSION_ADMISSION_BUSY');
    this.pending.set(id, 1);
    try { return work(); }
    finally { this.pending.delete(id); }
  }

  async runMutation<T>(id: string, work: (assertNotStopped: () => void) => Promise<T>): Promise<T> {
    const token = { stopped: this.stops.has(id) };
    const tokens = this.mutations.get(id) ?? new Set<{ stopped: boolean }>();
    tokens.add(token);
    this.mutations.set(id, tokens);
    try {
      return await this.runExclusive(id, () => work(() => {
        if (token.stopped) throw new ConflictException('SESSION_STOP_IN_PROGRESS');
      }));
    } finally {
      tokens.delete(token);
      if (!tokens.size) this.mutations.delete(id);
    }
  }

  private stop(id: string): () => void {
    this.stops.set(id, (this.stops.get(id) ?? 0) + 1);
    this.mutations.get(id)?.forEach(token => { token.stopped = true; });
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const remaining = this.stops.get(id)! - 1;
      if (remaining) this.stops.set(id, remaining);
      else this.stops.delete(id);
    };
  }

  async duringStop<T>(id: string, work: () => Promise<T>): Promise<T> {
    const release = this.stop(id);
    try { return await work(); }
    finally { release(); }
  }

  fenceStop<T extends { completion: Promise<void> }>(id: string, acquire: () => T): T {
    const release = this.stop(id);
    try {
      const lease = acquire();
      // Stop completion is an always-fulfilled acknowledgement, not wait().
      void lease.completion.then(release);
      return lease;
    } catch (error) { release(); throw error; }
  }
}
