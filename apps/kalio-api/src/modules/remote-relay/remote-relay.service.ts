import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Inject } from '@nestjs/common';
import type { ArchitectureRemoteGraphPort, ChatRemoteSupervisionPort, RemoteSupervisionPort, RemoteSupervisionSessionSnapshot } from '@kalio/types';
import { ARCHITECTURE_REMOTE_GRAPH_PORT, CHAT_REMOTE_SUPERVISION_PORT } from '@kalio/types';
import { nanoid } from 'nanoid';
import { createHash } from 'node:crypto';

interface Envelope { v: 1; type: string; instanceId: string; requestId?: string; sequence?: number; payload?: Record<string, unknown> }
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
@Injectable()
export class RemoteRelayService implements OnModuleInit, OnModuleDestroy, RemoteSupervisionPort {
  private readonly logger = new Logger(RemoteRelayService.name);
  private socket: WebSocket | null = null;
  private connectionGeneration = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private retry = 0;
  private sequence = 0;
  private stopped = false;
  private authenticated = false;
  private refreshTimer: ReturnType<typeof setInterval> | undefined;
  private readonly watchedSessions = new Map<string, { deviceId: string; sessionId: string; requestId: string }>();
  private readonly watchedSessionHashes = new Map<string, string>();
  private refreshInFlight: { generation: number; promise: Promise<void> } | undefined;
  private lastSnapshotHash = '';
  private lastSnapshotSentAt = 0;
  private readonly enabled = process.env['KALIO_REMOTE_RELAY_ENABLED'] === 'true';
  private readonly instanceId = process.env['KALIO_REMOTE_RELAY_INSTANCE_ID'] ?? '';
  private readonly instanceName = process.env['KALIO_REMOTE_RELAY_INSTANCE_NAME'] ?? '';
  private readonly token = process.env['KALIO_REMOTE_RELAY_TOKEN'] ?? '';
  private readonly url = process.env['KALIO_REMOTE_RELAY_URL'] ?? '';

  constructor(
    @Inject(CHAT_REMOTE_SUPERVISION_PORT) private readonly chat: ChatRemoteSupervisionPort,
    @Inject(ARCHITECTURE_REMOTE_GRAPH_PORT) private readonly architecture: ArchitectureRemoteGraphPort,
  ) {}

  onModuleInit(): void {
    if (!this.enabled) return;
    this.validateConfiguration();
    this.connect();
  }
  onModuleDestroy(): void {
    this.stopped = true;
    this.connectionGeneration += 1;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    this.socket?.close(1000, 'shutdown');
    this.socket = null;
  }

  async snapshot() {
    const projection = await this.chat.snapshot();
    return { instance: { id: this.instanceId, name: this.instanceName || this.instanceId }, ...projection };
  }

  async session(sessionId: string): Promise<RemoteSupervisionSessionSnapshot | null> {
    const session = await this.chat.session(sessionId);
    if (!session) return null;
    for (const runId of session.architectureRunIds) {
      const projection = await this.architecture.getGraph(runId);
      if (projection) return { session: session.session, messages: session.messages,
        graph: { available: true, runId, projection } };
    }
    return { session: session.session, messages: session.messages,
      graph: { available: false, reason: session.architectureRunIds.length ? 'projection_unavailable' : 'no_architecture_run' } };
  }

  decide(input: Parameters<ChatRemoteSupervisionPort['decide']>[0]) {
    return this.chat.decide(input);
  }

  async createPairing(): Promise<{ code: string; expiresAt: number }> {
    if (!this.authenticated || this.socket?.readyState !== WebSocket.OPEN) throw new Error('REMOTE_RELAY_OFFLINE');
    const requestId = nanoid();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingPairing.delete(requestId);
        reject(new Error('PAIRING_TIMEOUT'));
      }, 60_000);
      this.pendingPairing.set(requestId, { resolve, reject, timeout });
      if (!this.send('pair.create', { requestId })) {
        clearTimeout(timeout);
        this.pendingPairing.delete(requestId);
        reject(new Error('REMOTE_RELAY_OFFLINE'));
      }
    });
  }
  private readonly pendingPairing = new Map<string, {
    resolve: (value: { code: string; expiresAt: number }) => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
  }>();

  private connect(): void {
    if (this.stopped || !this.enabled) return;
    try {
      const socket = new WebSocket(this.url);
      const generation = ++this.connectionGeneration;
      this.socket = socket;
      socket.addEventListener('open', () => {
        if (!this.isCurrentConnection(socket, generation)) return;
        this.retry = 0;
        this.authenticated = false;
        this.send('agent.authenticate', { token: this.token });
      });
      socket.addEventListener('message', event => {
        if (!this.isCurrentConnection(socket, generation)) return;
        void this.receive(event.data, socket, generation).catch((error: unknown) => {
          this.logger.warn('Remote relay frame handling failed', error instanceof Error ? error.message : String(error));
        });
      });
      socket.addEventListener('close', () => {
        if (this.isCurrentConnection(socket, generation)) this.disconnected(socket, generation);
      });
      socket.addEventListener('error', () => {
        if (this.isCurrentConnection(socket, generation)) socket.close();
      });
    } catch {
      this.disconnected();
    }
  }

  private async receive(data: unknown, sourceSocket?: WebSocket, sourceGeneration?: number): Promise<void> {
    if (sourceSocket && sourceGeneration !== undefined && !this.isCurrentConnection(sourceSocket, sourceGeneration)) return;
    if (typeof data !== 'string') return;
    let envelope: unknown;
    try { envelope = JSON.parse(data) as unknown; } catch { return; }
    if (!isRecord(envelope) || envelope['v'] !== 1 || envelope['instanceId'] !== this.instanceId
      || typeof envelope['type'] !== 'string') return;
    const message = envelope as unknown as Envelope;
    if (message.type === 'auth.accepted') {
      if (this.authenticated) return;
      this.authenticated = true;
      this.retry = 0;
      if (this.refreshTimer) clearInterval(this.refreshTimer);
      const authSocket = sourceSocket ?? this.socket;
      const authGeneration = sourceGeneration ?? this.connectionGeneration;
      await this.refreshProjection(true);
      if (!authSocket || !this.isCurrentConnection(authSocket, authGeneration) || !this.authenticated) return;
      this.refreshTimer = setInterval(() => { void this.refreshProjection(false).catch((error: unknown) => this.logger.warn('Remote projection refresh failed', error instanceof Error ? error.message : String(error))); }, 2_000);
      this.refreshTimer.unref?.();
      return;
    }
    if (!this.authenticated) return;
    if (message.type === 'pair.created' && message.requestId) {
      const pending = this.pendingPairing.get(message.requestId);
      const payload = message.payload;
      if (pending && payload && typeof payload['code'] === 'string' && typeof payload['expiresAt'] === 'number') {
        clearTimeout(pending.timeout);
        this.pendingPairing.delete(message.requestId);
        pending.resolve({ code: payload['code'], expiresAt: payload['expiresAt'] });
      }
      return;
    }
    if (message.type === 'session.watch' && message.requestId && message.payload
      && typeof message.payload['sessionId'] === 'string' && typeof message.payload['deviceId'] === 'string'
      && /^[a-zA-Z0-9_-]{1,128}$/.test(message.payload['deviceId'])) {
      const sessionId = message.payload['sessionId'];
      const deviceId = message.payload['deviceId'];
      const watchKey = `${deviceId}:${sessionId}`;
      if (this.watchedSessions.size >= 20 && !this.watchedSessions.has(watchKey)) {
        this.send('session.snapshot', { requestId: message.requestId, session: null, error: 'watch_limit' });
        return;
      }
      this.watchedSessions.set(watchKey, { deviceId, sessionId, requestId: message.requestId });
      const result = await this.session(sessionId);
      if (sourceSocket && sourceGeneration !== undefined && !this.isCurrentConnection(sourceSocket, sourceGeneration)) return;
      this.watchedSessionHashes.set(watchKey, createHash('sha256').update(JSON.stringify(result)).digest('hex'));
      this.send('session.snapshot', { requestId: message.requestId, ...(result ?? { session: null }) });
      return;
    }
    if (message.type === 'approval.decide' && message.requestId && message.payload) {
      const { approvalId, revision, argsSha256, decision, deviceId } = message.payload;
      const result = typeof approvalId === 'string' && typeof revision === 'string'
        && typeof argsSha256 === 'string' && typeof deviceId === 'string'
        && (decision === 'approve' || decision === 'deny')
        ? await this.decide({ approvalId, revision, argsSha256, decision, deviceId })
        : { status: 'rejected' as const };
      if (sourceSocket && sourceGeneration !== undefined && !this.isCurrentConnection(sourceSocket, sourceGeneration)) return;
      this.send('approval.result', { requestId: message.requestId, approvalId, ...result });
      await this.refreshProjection(false);
    }
  }

  private refreshProjection(force: boolean): Promise<void> {
    const socket = this.socket;
    const generation = this.connectionGeneration;
    if (!this.authenticated || !socket) return Promise.resolve();
    if (this.refreshInFlight?.generation === generation) return this.refreshInFlight.promise;
    const promise = this.refreshProjectionNow(force, socket, generation);
    this.refreshInFlight = { generation, promise };
    void promise.then(() => {
      if (this.refreshInFlight?.promise === promise) this.refreshInFlight = undefined;
    }, () => {
      if (this.refreshInFlight?.promise === promise) this.refreshInFlight = undefined;
    });
    return promise;
  }

  private async refreshProjectionNow(force: boolean, socket: WebSocket, generation: number): Promise<void> {
    if (!this.isCurrentConnection(socket, generation) || !this.authenticated) return;
    const current = await this.snapshot();
    if (!this.isCurrentConnection(socket, generation) || !this.authenticated) return;
    const snapshotHash = createHash('sha256').update(JSON.stringify(current)).digest('hex');
    if (force || snapshotHash !== this.lastSnapshotHash || Date.now() - this.lastSnapshotSentAt >= 10_000) {
      this.lastSnapshotHash = snapshotHash;
      this.lastSnapshotSentAt = Date.now();
      this.send('snapshot', current as unknown as Record<string, unknown>);
    }
    for (const [watchKey, watch] of this.watchedSessions) {
      const projection = await this.session(watch.sessionId);
      if (!this.isCurrentConnection(socket, generation) || !this.authenticated) return;
      const hash = createHash('sha256').update(JSON.stringify(projection)).digest('hex');
      if (force || this.watchedSessionHashes.get(watchKey) !== hash) {
        this.watchedSessionHashes.set(watchKey, hash);
        this.send('session.snapshot', { requestId: watch.requestId, ...(projection ?? { session: null }) });
      }
    }
  }
  private isCurrentConnection(socket: WebSocket, generation: number): boolean {
    return this.socket === socket && this.connectionGeneration === generation;
  }
  private send(type: string, payload?: Record<string, unknown>): boolean {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return false;
    const requestId = payload && typeof payload['requestId'] === 'string' ? payload['requestId'] as string : undefined;
    const cleanPayload = payload ? { ...payload } : undefined;
    if (cleanPayload) delete cleanPayload['requestId'];
    const envelope: Envelope = { v: 1, type, instanceId: this.instanceId, sequence: ++this.sequence,
      ...(requestId ? { requestId } : {}), ...(cleanPayload ? { payload: cleanPayload } : {}) };
    this.socket.send(JSON.stringify(envelope));
    return true;
  }
  private disconnected(socket?: WebSocket, generation?: number): void {
    if (socket && generation !== undefined && !this.isCurrentConnection(socket, generation)) return;
    this.authenticated = false;
    this.connectionGeneration += 1;
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    this.refreshTimer = undefined;
    this.watchedSessions.clear();
    this.watchedSessionHashes.clear();
    this.refreshInFlight = undefined;
    this.lastSnapshotHash = '';
    this.lastSnapshotSentAt = 0;
    this.socket = null;
    for (const [id, pending] of this.pendingPairing) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('REMOTE_RELAY_OFFLINE'));
      this.pendingPairing.delete(id);
    }
    if (this.stopped || !this.enabled || this.reconnectTimer) return;
    const delay = Math.min(30_000, 500 * (2 ** Math.min(this.retry++, 6))) + Math.floor(Math.random() * 250);
    this.reconnectTimer = setTimeout(() => { this.reconnectTimer = undefined; this.connect(); }, delay);
    this.reconnectTimer.unref?.();
  }
  private validateConfiguration(): void {
    if (!this.instanceId || !this.instanceName || !this.token || !this.url) throw new Error('REMOTE_RELAY_CONFIGURATION_REQUIRED');
    if (!/^[a-f0-9]{64}$/i.test(this.token)) throw new Error('REMOTE_RELAY_TOKEN_MUST_BE_64_HEX');
    const url = new URL(this.url);
    if (url.protocol !== 'wss:' && !(url.protocol === 'ws:' && ['localhost','127.0.0.1','[::1]'].includes(url.hostname))) {
      throw new Error('REMOTE_RELAY_URL_MUST_USE_WSS');
    }
  }
}
