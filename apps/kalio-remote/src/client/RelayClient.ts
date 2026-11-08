import type { Approval, Envelope, Snapshot, SessionSnapshot } from '../protocol';
import { isRecord, parseSession, parseSnapshot } from '../protocol';

export type RelayEvent =
  | { kind: 'snapshot'; instanceId: string; value: Snapshot; sequence: number }
  | { kind: 'session'; instanceId: string; value: SessionSnapshot }
  | { kind: 'offline'; instanceId: string }
  | { kind: 'result'; instanceId: string; requestId: string; approvalId: string; status: string }
  | { kind: 'error'; instanceId: string; message: string };
type PairReply = { v: 1; instanceId: string; deviceId: string; token: string };
type Outstanding = { approvalId: string; decision: 'approve'|'deny'; revision: string };
export class RelayClient {
  private socket: WebSocket | null = null;
  private listeners = new Set<(event: RelayEvent) => void>();
  private requestSeq = 0;
  private selectedSession: string | null = null;
  private snapshotAt = 0;
  private lastSequence = -1;
  private fresh = false;
  private authenticated = false;
  private closed = false;
  private generation = 0;
  private outstanding = new Map<string, Outstanding>();
  private watchRequestId: string | null = null;
  constructor(private baseUrl: string, private pair: PairReply) {}
  get instanceId(): string { return this.pair.instanceId; }
  get deviceId(): string { return this.pair.deviceId; }
  subscribe(listener: (event: RelayEvent) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  connect(): void {
    const generation = ++this.generation;
    this.authenticated = false; this.fresh = false; this.lastSequence = -1; this.snapshotAt = 0; this.outstanding.clear();
    const url = new URL('/v1/device', this.baseUrl);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(url); this.socket = socket;
    socket.onopen = () => { if (generation === this.generation) socket.send(JSON.stringify({ v: 1, type: 'auth', instanceId: this.pair.instanceId, token: this.pair.token })); };
    socket.onmessage = (event) => { if (generation === this.generation) this.receive(event.data); };
    socket.onclose = () => { if (generation !== this.generation) return; this.fresh = false; this.authenticated = false; this.emit({ kind: 'offline', instanceId: this.instanceId }); if (!this.closed) window.setTimeout(() => this.connect(), 1500); };
    socket.onerror = () => { if (generation === this.generation) this.emit({ kind: 'error', instanceId: this.instanceId, message: 'Relay connection failed.' }); };
  }
  watch(sessionId: string): void { this.selectedSession = sessionId || null; this.watchRequestId = null; if (this.fresh && sessionId) { const requestId=this.id(); this.watchRequestId=requestId; this.send({ type: 'session.watch', requestId, sessionId }); } }
  decide(approval: Approval, decision: 'approve' | 'deny'): string {
    if (!this.canDecide()) throw new Error('Relay snapshot is stale or offline.');
    const requestId = this.id();
    this.outstanding.set(requestId, { approvalId: approval.id, decision, revision: approval.revision });
    this.send({ type: 'approval.decide', requestId, approvalId: approval.id, revision: approval.revision, argsSha256: approval.argsSha256, decision });
    return requestId;
  }
  canDecide(): boolean { return Boolean(this.socket?.readyState === WebSocket.OPEN && this.authenticated && this.fresh && Date.now() - this.snapshotAt < 15000); }
  disconnect(): void { this.closed = true; this.generation++; this.socket?.close(); this.pair.token = ''; this.outstanding.clear(); }
  private id(): string { return 'm-' + (++this.requestSeq).toString(36); }
  private send(data: Record<string, unknown>): void { if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify({ v: 1, instanceId: this.pair.instanceId, ...data })); }
  private emit(event: RelayEvent): void { this.listeners.forEach(listener => listener(event)); }
  private receive(raw: unknown): void {
    let data: unknown; try { data = JSON.parse(String(raw)); } catch { this.emit({ kind: 'error', instanceId: this.instanceId, message: 'Relay sent invalid JSON.' }); return; }
    if (!isRecord(data) || data.v !== 1 || data.instanceId !== this.pair.instanceId || typeof data.type !== 'string') return;
    const envelope = data as unknown as Envelope;
    if (envelope.type === 'auth.accepted') { this.authenticated = true; return; }
    if (!this.authenticated) return;
    if (envelope.type === 'snapshot' && typeof envelope.sequence === 'number') {
      if (envelope.sequence <= this.lastSequence) return;
      const value = parseSnapshot(envelope.payload);
      if (!value || value.instance.id !== this.pair.instanceId) return;
      this.lastSequence = envelope.sequence; this.snapshotAt = Date.now(); this.fresh = true;
      this.emit({ kind: 'snapshot', instanceId: this.instanceId, value, sequence: envelope.sequence });
      if (this.selectedSession) this.watch(this.selectedSession);
    } else if (envelope.type === 'session.snapshot') {
      const value = parseSession(envelope.payload); if (value) this.emit({ kind: 'session', instanceId: this.instanceId, value });
    } else if (envelope.type === 'approval.result' && typeof envelope.requestId === 'string' && isRecord(envelope.payload) && typeof envelope.payload.approvalId === 'string' && typeof envelope.payload.status === 'string') {
      const expected = this.outstanding.get(envelope.requestId);
      if (!expected || expected.approvalId !== envelope.payload.approvalId) return;
      this.outstanding.delete(envelope.requestId);
      this.emit({ kind: 'result', instanceId: this.instanceId, requestId: envelope.requestId, approvalId: envelope.payload.approvalId, status: envelope.payload.status });
    } else if (envelope.type === 'instance.offline') { this.fresh = false; this.emit({ kind: 'offline', instanceId: this.instanceId }); }
  }
}
export async function pairRelay(relayUrl: string, code: string): Promise<RelayClient> {
  const parsed = new URL(relayUrl);
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname))) throw new Error('Use HTTPS for relay pairing, except loopback development.');
  const response = await fetch(new URL('/v1/pair', parsed), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code }) });
  if (!response.ok) throw new Error('Pairing failed. Check the one-use code and relay address.');
  const result: unknown = await response.json();
  if (!isRecord(result) || result.v !== 1 || typeof result.instanceId !== 'string' || typeof result.deviceId !== 'string' || typeof result.token !== 'string') throw new Error('Relay returned an invalid pairing response.');
  return new RelayClient(parsed.toString(), { v: 1, instanceId: result.instanceId, deviceId: result.deviceId, token: result.token });
}
