import { afterEach, describe, expect, it, vi } from 'vitest';
import { RemoteRelayService } from './remote-relay.service';

type Listener = (event: { data?: unknown }) => void;
class FakeWebSocket {
  static readonly OPEN = 1;
  readyState = 1;
  sent: string[] = [];
  listeners = new Map<string, Listener>();
  addEventListener(type: string, listener: Listener): void { this.listeners.set(type, listener); }
  send(data: string): void { this.sent.push(data); }
  close(): void { this.readyState = 3; }
  emit(type: string, event: { data?: unknown } = {}): void { this.listeners.get(type)?.(event); }
}
function createService() {
  const chat = { snapshot: vi.fn().mockResolvedValue({ sessions: [], approvals: [] }), session: vi.fn().mockResolvedValue(null), decide: vi.fn() };
  const architecture = { getGraph: vi.fn().mockResolvedValue(null) };
  return { service: new RemoteRelayService(chat as never, architecture as never), chat };
}
function internal(service: RemoteRelayService): {
  receive(data: unknown): Promise<void>;
  socket: FakeWebSocket | null;
  authenticated: boolean;
  instanceId: string;
  refreshProjection(force: boolean): Promise<void>;
} {
  return service as unknown as { receive(data: unknown): Promise<void>; socket: FakeWebSocket | null; authenticated: boolean; instanceId: string; refreshProjection(force: boolean): Promise<void> };
}

describe('RemoteRelayService protocol lifecycle', () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  it('stays disconnected when the feature flag is disabled', () => {
    vi.stubEnv('KALIO_REMOTE_RELAY_ENABLED', 'false');
    const socketCtor = vi.fn();
    vi.stubGlobal('WebSocket', socketCtor);
    const { service } = createService();
    service.onModuleInit();
    expect(socketCtor).not.toHaveBeenCalled();
  });

  it('sends the configured first-frame credential and waits for auth.accepted', async () => {
    vi.stubEnv('KALIO_REMOTE_RELAY_ENABLED', 'true');
    vi.stubEnv('KALIO_REMOTE_RELAY_INSTANCE_ID', 'instance-1');
    vi.stubEnv('KALIO_REMOTE_RELAY_INSTANCE_NAME', 'Kalio');
    vi.stubEnv('KALIO_REMOTE_RELAY_TOKEN', 'a'.repeat(64));
    vi.stubEnv('KALIO_REMOTE_RELAY_URL', 'wss://relay.example/v1/agent/instance-1');
    let socket: FakeWebSocket | undefined;
    vi.stubGlobal('WebSocket', class extends FakeWebSocket {
      constructor() { super(); socket = this; }
    });
    const { service, chat } = createService();
    service.onModuleInit();
    socket!.emit('open');
    const auth = JSON.parse(socket!.sent[0]!) as { type: string; payload: { token: string } };
    expect(auth.type).toBe('agent.authenticate');
    expect(auth.payload.token).toBe('a'.repeat(64));
    expect(chat.snapshot).not.toHaveBeenCalled();
    await internal(service).receive(JSON.stringify({ v: 1, type: 'auth.accepted', instanceId: 'instance-1' }));
    expect(chat.snapshot).toHaveBeenCalledTimes(1);
    expect(internal(service).authenticated).toBe(true);
    service.onModuleDestroy();
  });

  it('ignores malformed, wrong-version, and cross-instance frames without projection calls', async () => {
    vi.stubEnv('KALIO_REMOTE_RELAY_ENABLED', 'false');
    const { service, chat } = createService();
    const receive = internal(service).receive.bind(internal(service));
    await receive('{');
    await receive({ v: 1, type: 'session.watch', instanceId: 'instance-1' });
    await receive(JSON.stringify({ v: 2, type: 'session.watch', instanceId: 'instance-1' }));
    await receive(JSON.stringify({ v: 1, type: 'session.watch', instanceId: 'other-instance' }));
    expect(chat.snapshot).not.toHaveBeenCalled();
    expect(chat.session).not.toHaveBeenCalled();
  });
  it('preserves each watched device requestId on initial and live session snapshots', async () => {
    vi.stubEnv('KALIO_REMOTE_RELAY_ENABLED', 'false');
    vi.stubGlobal('WebSocket', FakeWebSocket);
    const { service } = createService();
    const state = internal(service);
    state.instanceId = 'instance-1';
    state.socket = new FakeWebSocket();
    state.authenticated = true;
    const watch = { v: 1, type: 'session.watch', instanceId: 'instance-1', requestId: 'watch-1',
      payload: { sessionId: 'session-1', deviceId: 'device-1' } };
    await state.receive(JSON.stringify(watch));
    await state.refreshProjection(true);
    const snapshots = state.socket.sent.map((frame) => JSON.parse(frame) as { type: string; requestId?: string });
    expect(snapshots.filter((frame) => frame.type === 'session.snapshot').map((frame) => frame.requestId))
      .toEqual(['watch-1', 'watch-1']);
    service.onModuleDestroy();
  });

  it('sends an unchanged authoritative snapshot heartbeat every ten seconds', async () => {
    vi.useFakeTimers();
    vi.stubEnv('KALIO_REMOTE_RELAY_ENABLED', 'true');
    vi.stubEnv('KALIO_REMOTE_RELAY_INSTANCE_ID', 'instance-1');
    vi.stubEnv('KALIO_REMOTE_RELAY_INSTANCE_NAME', 'Kalio');
    vi.stubEnv('KALIO_REMOTE_RELAY_TOKEN', 'a'.repeat(64));
    vi.stubEnv('KALIO_REMOTE_RELAY_URL', 'wss://relay.example/v1/agent/instance-1');
    let socket: FakeWebSocket | undefined;
    vi.stubGlobal('WebSocket', class extends FakeWebSocket { constructor() { super(); socket = this; } });
    const { service } = createService();
    service.onModuleInit();
    socket!.emit('open');
    await internal(service).receive(JSON.stringify({ v: 1, type: 'auth.accepted', instanceId: 'instance-1' }));
    const snapshotCount = () => socket!.sent.map((frame) => JSON.parse(frame) as { type: string })
      .filter((frame) => frame.type === 'snapshot').length;
    expect(snapshotCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(9_999);
    expect(snapshotCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(snapshotCount()).toBe(2);
    await internal(service).receive(JSON.stringify({ v: 1, type: 'auth.accepted', instanceId: 'instance-1' }));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(snapshotCount()).toBe(3);
    service.onModuleDestroy();
  });

  it('shares one in-flight projection refresh across timer ticks', async () => {
    const { service, chat } = createService();
    vi.stubGlobal('WebSocket', FakeWebSocket);
    const state = internal(service);
    state.authenticated = true;
    state.socket = new FakeWebSocket();
    let release!: (value: { sessions: []; approvals: [] }) => void;
    chat.snapshot.mockReturnValueOnce(new Promise((resolve) => { release = resolve; }));
    const first = state.refreshProjection(false);
    const second = state.refreshProjection(false);
    expect(chat.snapshot).toHaveBeenCalledTimes(1);
    release({ sessions: [], approvals: [] });
    await Promise.all([first, second]);
  });

});
