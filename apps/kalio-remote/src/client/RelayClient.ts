import type { Approval, Envelope, Snapshot, SessionSnapshot } from '../protocol';
import { isRecord, parseSession, parseSnapshot } from '../protocol';

export type RelayEvent = { kind: 'snapshot'; value: Snapshot; sequence: number } | { kind: 'session'; value: SessionSnapshot } | { kind: 'offline' } | { kind: 'result'; requestId: string; approvalId: string; status: string } | { kind: 'error'; message: string };
type PairReply = { v: 1; instanceId: string; deviceId: string; token: string };
export class RelayClient {
  private socket: WebSocket | null = null;
  private listeners = new Set<(event: RelayEvent) => void>();
  private requestSeq = 0;
  private selectedSession: string | null = null;
  private snapshotAt = 0;
  private lastSequence = -1;
  private fresh = false;
  private closed = false;
  constructor(private baseUrl: string, private pair: PairReply) {}
  subscribe(listener: (event: RelayEvent) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  connect(): void {
    const url = new URL('/relay/v1/device', this.baseUrl);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    this.socket = new WebSocket(url);
    this.socket.onopen = () => this.socket?.send(JSON.stringify({ v: 1, type: 'auth', instanceId: this.pair.instanceId, token: this.pair.token }));
    this.socket.onmessage = (event) => this.receive(event.data);
    this.socket.onclose = () => { this.fresh = false; this.emit({ kind: 'offline' }); if (!this.closed) window.setTimeout(() => this.connect(), 1500); };
    this.socket.onerror = () => this.emit({ kind: 'error', message: 'Relay connection failed.' });
  }
  watch(sessionId: string): void { this.selectedSession = sessionId; if (this.fresh) this.send({ type: 'session.watch', requestId: this.id(), sessionId }); }
  decide(approval: Approval, decision: 'approve' | 'deny'): string {
    if (!this.canDecide()) throw new Error('Relay snapshot is stale or offline.');
    const requestId = this.id();
    this.send({ type: 'approval.decide', requestId, approvalId: approval.id, revision: approval.revision, argsSha256: approval.argsSha256, decision });
    return requestId;
  }
  canDecide(): boolean { return Boolean(this.socket?.readyState === WebSocket.OPEN && this.fresh && Date.now() - this.snapshotAt < 15000); }
  disconnect(): void { this.closed = true; this.socket?.close(); this.pair.token = ''; }
  private id(): string { return 'm-' + (++this.requestSeq).toString(36); }
  private send(data: Record<string, unknown>): void { this.socket?.send(JSON.stringify({ v: 1, instanceId: this.pair.instanceId, ...data })); }
  private emit(event: RelayEvent): void { this.listeners.forEach(listener => listener(event)); }
  private receive(raw: unknown): void {
    let data: unknown; try { data = JSON.parse(String(raw)); } catch { this.emit({ kind: 'error', message: 'Relay sent invalid JSON.' }); return; }
    if (!isRecord(data) || data.v !== 1 || data.instanceId !== this.pair.instanceId || typeof data.type !== 'string') return;
    const envelope = data as unknown as Envelope;
    if (envelope.type === 'snapshot' && typeof envelope.sequence === 'number') {
      if (envelope.sequence <= this.lastSequence) return;
      const value = parseSnapshot(envelope.payload);
      if (!value || value.instance.id !== this.pair.instanceId) return;
      this.lastSequence = envelope.sequence; this.snapshotAt = Date.now(); this.fresh = true;
      this.emit({ kind: 'snapshot', value, sequence: envelope.sequence });
      if (this.selectedSession) this.watch(this.selectedSession);
    } else if (envelope.type === 'session.snapshot') {
      const value = parseSession(envelope.payload); if (value) this.emit({ kind: 'session', value });
    } else if (envelope.type === 'approval.result' && typeof envelope.requestId === 'string' && isRecord(envelope.payload) && typeof envelope.payload.approvalId === 'string' && typeof envelope.payload.status === 'string') {
      this.emit({ kind: 'result', requestId: envelope.requestId, approvalId: envelope.payload.approvalId, status: envelope.payload.status });
    } else if (envelope.type === 'instance.offline') { this.fresh = false; this.emit({ kind: 'offline' }); }
  }
}
export async function pairRelay(relayUrl: string, code: string): Promise<{ client: RelayClient; snapshot: null }> {
  const parsed = new URL(relayUrl);
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname))) throw new Error('Use HTTPS for relay pairing, except loopback development.');
  const response = await fetch(new URL('/relay/v1/pair', parsed), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code }) });
  if (!response.ok) throw new Error('Pairing failed. Check the one-use code and relay address.');
  const result: unknown = await response.json();
  if (!isRecord(result) || result.v !== 1 || typeof result.instanceId !== 'string' || typeof result.deviceId !== 'string' || typeof result.token !== 'string') throw new Error('Relay returned an invalid pairing response.');
  const client = new RelayClient(parsed.toString(), { v: 1, instanceId: result.instanceId, deviceId: result.deviceId, token: result.token });
  client.connect(); return { client, snapshot: null };
}
