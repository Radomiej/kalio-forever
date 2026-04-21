import { apiClient } from './apiClient';

/**
 * Backend health watcher — unified source of truth for "is the backend reachable
 * and is its database available?". Stores subscribe here to know when to
 * re-initialize after a transient outage (e.g. PG container restart,
 * docker-desktop gateway hiccup, dev server restart).
 */

export type BackendHealthState = 'online' | 'offline' | 'unknown';

export interface BackendHealthListener {
  (state: BackendHealthState, prev: BackendHealthState): void;
}

const POLL_ONLINE_MS = 30_000;   // occasional keep-alive while things look fine
const POLL_OFFLINE_BASE_MS = 2_000;
const POLL_OFFLINE_MAX_MS = 30_000;
const POLL_OFFLINE_JITTER = 0.2;

class BackendHealthService {
  private state: BackendHealthState = 'unknown';
  private listeners = new Set<BackendHealthListener>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private offlineAttempt = 0;
  private started = false;

  getState(): BackendHealthState {
    return this.state;
  }

  isOnline(): boolean {
    return this.state === 'online';
  }

  /** Subscribe to state transitions. Returns an unsubscribe function. */
  subscribe(fn: BackendHealthListener): () => void {
    this.listeners.add(fn);
    // Fire immediately so new subscribers know current state
    try { fn(this.state, this.state); } catch { /* listener errors are not fatal */ }
    return () => { this.listeners.delete(fn); };
  }

  /** Start periodic polling. Idempotent. */
  start(): void {
    if (this.started) return;
    this.started = true;
    // Fire an immediate probe so we know state ASAP
    void this.probe();
  }

  stop(): void {
    this.started = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /** Externally signal that a recent API call returned 503/network error. */
  reportFailure(): void {
    if (this.state !== 'offline') this.setState('offline');
    this.scheduleNext();
  }

  /** Externally signal that a recent API call succeeded. */
  reportSuccess(): void {
    if (this.state !== 'online') this.setState('online');
    this.offlineAttempt = 0;
    this.scheduleNext();
  }

  private setState(next: BackendHealthState): void {
    const prev = this.state;
    if (prev === next) return;
    this.state = next;
    for (const fn of this.listeners) {
      try { fn(next, prev); } catch { /* listener errors are not fatal */ }
    }
  }

  private async probe(): Promise<void> {
    try {
      await apiClient.get('/health');
      this.reportSuccess();
    } catch {
      this.reportFailure();
    }
  }

  private computeOfflineDelay(): number {
    const clamped = Math.min(this.offlineAttempt, 5);
    const base = Math.min(POLL_OFFLINE_BASE_MS * Math.pow(2, clamped), POLL_OFFLINE_MAX_MS);
    const jitter = base * POLL_OFFLINE_JITTER * (Math.random() * 2 - 1);
    return Math.max(500, Math.round(base + jitter));
  }

  private scheduleNext(): void {
    if (!this.started) return;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const delay = this.state === 'online' ? POLL_ONLINE_MS : this.computeOfflineDelay();
    if (this.state !== 'online') this.offlineAttempt += 1;
    this.timer = setTimeout(() => { void this.probe(); }, delay);
  }
}

export const backendHealth = new BackendHealthService();
