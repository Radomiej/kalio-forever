import { afterEach, describe, expect, it, vi } from 'vitest';
import { hostname } from 'node:os';
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
  connectionGeneration: number;
  refreshInFlight: { generation: number; promise: Promise<void> } | undefined;
} {
  return service as unknown as { receive(data: unknown): Promise<void>; socket: FakeWebSocket | null; authenticated: boolean; instanceId: string; refreshProjection(force: boolean): Promise<void>; connectionGeneration: number; refreshInFlight: { generation: number; promise: Promise<void> } | undefined };
}

function watchConnection(service: RemoteRelayService) {
  vi.stubGlobal('WebSocket', FakeWebSocket);
  const state = internal(service);
  state.instanceId = 'instance-1';
  const socket = new FakeWebSocket();
  state.socket = socket;
  state.authenticated = true;
  const watch = (sessionId: string) => state.receive(JSON.stringify({
    v: 1, type: 'session.watch', instanceId: 'instance-1', requestId: 'watch',
    payload: { sessionId, deviceId: 'device' },
  }));
  return { state, socket, watch };
}

function watchFrames(socket: FakeWebSocket) {
  return socket.sent.map((frame) => JSON.parse(frame) as { type: string; requestId?: string; payload?: unknown })
    .filter((frame) => frame.type === 'session.snapshot');
}

describe('RemoteRelayService protocol lifecycle', () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  it('publishes the computer name when no explicit instance name is configured', async () => {
    vi.stubEnv('KALIO_REMOTE_RELAY_INSTANCE_NAME', '  ');
    vi.stubEnv('KALIO_REMOTE_RELAY_INSTANCE_ID', 'qa-host');
    const { service } = createService();
    await expect(service.snapshot()).resolves.toMatchObject({ instance: { id: 'qa-host', name: hostname() } });
  });

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
    const sockets: FakeWebSocket[] = [];
    vi.stubGlobal('WebSocket', class extends FakeWebSocket {
      constructor() { super(); sockets.push(this); }
    });
    const { service, chat } = createService();
    service.onModuleInit();
    const socket = sockets[0]!;
    socket.emit('open');
    const auth = JSON.parse(socket.sent[0]!) as { type: string; payload: { token: string } };
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

  it('ignores an in-flight watch after replacement, even when its request ID is reused', async () => {
    const { service, chat } = createService();
    const { state, socket, watch } = watchConnection(service);
    let releaseOld!: (session: null) => void;
    chat.session.mockImplementationOnce(() => new Promise((resolve) => { releaseOld = resolve; }));
    const old = watch('old');
    await watch('current');
    releaseOld(null);
    await old;
    await state.refreshProjection(true);
    expect(chat.session.mock.calls).toEqual([['old'], ['current'], ['current']]);
    expect(watchFrames(socket)).toEqual([
      expect.objectContaining({ requestId: 'watch', payload: { deviceId: 'device', session: null, error: 'session_not_found' } }),
      expect.objectContaining({ requestId: 'watch', payload: { deviceId: 'device', session: null, error: 'session_not_found' } }),
    ]);
  });

  it('drops late refreshes across unwatch and socket replacement while reporting current failures', async () => {
    const { service, chat } = createService();
    const { state, socket, watch } = watchConnection(service);
    await watch('initial');
    socket.sent.length = 0;
    let rejectOld!: (error: Error) => void;
    chat.session.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectOld = reject; }));
    const oldRefresh = state.refreshProjection(true);
    await vi.waitFor(() => expect(chat.session).toHaveBeenCalledTimes(2));
    await state.receive(JSON.stringify({ v: 1, type: 'session.unwatch', instanceId: 'instance-1', payload: { deviceId: 'device' } }));
    state.socket = new FakeWebSocket();
    state.connectionGeneration += 1;
    chat.session.mockRejectedValueOnce(new Error('internal projection data'));
    await watch('current');
    rejectOld(new Error('old socket projection'));
    await oldRefresh;
    expect(watchFrames(socket)).toEqual([]);
    expect(watchFrames(state.socket)).toEqual([
      expect.objectContaining({ requestId: 'watch', payload: { deviceId: 'device', session: null, error: 'projection_failed' } }),
    ]);
    await state.refreshProjection(false);
    expect(watchFrames(state.socket).at(-1)?.payload).toEqual({ deviceId: 'device', session: null, error: 'session_not_found' });
  });

  it('retries overview hydration when the first authenticated projection fails', async () => {
    vi.useFakeTimers();
    const { service, chat } = createService();
    const { state, socket } = watchConnection(service);
    state.authenticated = false;
    chat.snapshot.mockRejectedValueOnce(new Error('not ready'));
    await expect(state.receive(JSON.stringify({ v: 1, type: 'auth.accepted', instanceId: 'instance-1' }))).rejects.toThrow('not ready');
    await vi.advanceTimersByTimeAsync(2_000);
    expect(socket.sent.map((frame) => (JSON.parse(frame) as { type: string }).type)).toEqual(['snapshot']);
    service.onModuleDestroy();
  });

  it('sends an unchanged authoritative snapshot heartbeat every ten seconds', async () => {
    vi.useFakeTimers();
    vi.stubEnv('KALIO_REMOTE_RELAY_ENABLED', 'true');
    vi.stubEnv('KALIO_REMOTE_RELAY_INSTANCE_ID', 'instance-1');
    vi.stubEnv('KALIO_REMOTE_RELAY_INSTANCE_NAME', 'Kalio');
    vi.stubEnv('KALIO_REMOTE_RELAY_TOKEN', 'a'.repeat(64));
    vi.stubEnv('KALIO_REMOTE_RELAY_URL', 'wss://relay.example/v1/agent/instance-1');
    const sockets: FakeWebSocket[] = [];
    vi.stubGlobal('WebSocket', class extends FakeWebSocket { constructor() { super(); sockets.push(this); } });
    const { service } = createService();
    service.onModuleInit();
    const socket = sockets[0]!;
    socket.emit('open');
    await internal(service).receive(JSON.stringify({ v: 1, type: 'auth.accepted', instanceId: 'instance-1' }));
    const snapshotCount = () => socket.sent.map((frame) => JSON.parse(frame) as { type: string })
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

  it('does not send an old refresh to a new socket or clear the new generation singleflight', async () => {
    const { service, chat } = createService();
    vi.stubGlobal('WebSocket', FakeWebSocket);
    const state = internal(service);
    state.instanceId = 'instance-1';
    const oldSocket = new FakeWebSocket();
    state.socket = oldSocket;
    state.authenticated = true;
    state.connectionGeneration = 1;
    let releaseOld!: (value: { sessions: []; approvals: [] }) => void;
    let releaseNew!: (value: { sessions: []; approvals: [] }) => void;
    chat.snapshot.mockImplementationOnce(() => new Promise((resolve) => { releaseOld = resolve; }))
      .mockImplementationOnce(() => new Promise((resolve) => { releaseNew = resolve; }));
    const oldRefresh = state.refreshProjection(true);

    state.authenticated = false;
    state.socket = null;
    state.connectionGeneration += 1;
    state.refreshInFlight = undefined;
    const newSocket = new FakeWebSocket();
    state.socket = newSocket;
    state.authenticated = true;
    state.connectionGeneration += 1;
    const newRefresh = state.refreshProjection(true);

    releaseOld({ sessions: [], approvals: [] });
    await oldRefresh;
    expect(oldSocket.sent).toHaveLength(0);
    expect(newSocket.sent).toHaveLength(0);
    expect(internal(service).refreshInFlight?.promise).toBe(newRefresh);

    releaseNew({ sessions: [], approvals: [] });
    await newRefresh;
    expect(newSocket.sent.map((frame) => (JSON.parse(frame) as { type: string }).type)).toEqual(['snapshot']);
  });

});
