import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Inject } from '@nestjs/common';
import type { ArchitectureRemoteGraphPort, ChatRemoteSupervisionPort, RemoteSupervisionPort, RemoteSupervisionSessionSnapshot } from '@kalio/types';
import { ARCHITECTURE_REMOTE_GRAPH_PORT, CHAT_REMOTE_SUPERVISION_PORT } from '@kalio/types';
import { nanoid } from 'nanoid';

interface Envelope { v: 1; type: string; instanceId: string; requestId?: string; sequence?: number; payload?: Record<string, unknown> }
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
@Injectable()
export class RemoteRelayService implements OnModuleInit, OnModuleDestroy, RemoteSupervisionPort {
  private readonly logger = new Logger(RemoteRelayService.name);
  private socket: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private retry = 0;
  private sequence = 0;
  private stopped = false;
  private authenticated = false;
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
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
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
      this.socket = socket;
      socket.addEventListener('open', () => {
        this.retry = 0;
        this.authenticated = false;
        this.send('agent.authenticate', { token: this.token });
      });
      socket.addEventListener('message', event => void this.receive(event.data));
      socket.addEventListener('close', () => this.disconnected());
      socket.addEventListener('error', () => socket.close());
    } catch {
      this.disconnected();
    }
  }

  private async receive(data: unknown): Promise<void> {
    if (typeof data !== 'string') return;
    let envelope: unknown;
    try { envelope = JSON.parse(data) as unknown; } catch { return; }
    if (!isRecord(envelope) || envelope['v'] !== 1 || envelope['instanceId'] !== this.instanceId
      || typeof envelope['type'] !== 'string') return;
    const message = envelope as unknown as Envelope;
    if (message.type === 'auth.accepted') {
      this.authenticated = true;
      this.retry = 0;
      const snapshot = await this.snapshot();
      this.send('snapshot', snapshot as unknown as Record<string, unknown>);
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
      && typeof message.payload['sessionId'] === 'string') {
      const result = await this.session(message.payload['sessionId']);
      this.send('session.snapshot', { requestId: message.requestId, ...(result ?? { session: null }) });
      return;
    }
    if (message.type === 'approval.decide' && message.requestId && message.payload) {
      const { approvalId, revision, argsSha256, decision } = message.payload;
      const result = typeof approvalId === 'string' && typeof revision === 'string'
        && typeof argsSha256 === 'string' && (decision === 'approve' || decision === 'deny')
        ? await this.decide({ approvalId, revision, argsSha256, decision })
        : { status: 'rejected' as const };
      this.send('approval.result', { requestId: message.requestId, approvalId, ...result });
    }
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
  private disconnected(): void {
    this.authenticated = false;
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
