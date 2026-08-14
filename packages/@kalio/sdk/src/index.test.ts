import { describe, expect, it, vi, beforeEach } from 'vitest';
import { KalioSDK } from './index';

type SocketHandler = (...args: unknown[]) => void;

interface FakeSocket {
  recovered: boolean;
  connected: boolean;
  on: ReturnType<typeof vi.fn>;
  off: ReturnType<typeof vi.fn>;
  emit: ReturnType<typeof vi.fn>;
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  io: {
    on: ReturnType<typeof vi.fn>;
    off: ReturnType<typeof vi.fn>;
  };
}

const handlers = new Map<string, SocketHandler>();
const managerHandlers = new Map<string, SocketHandler>();
let fakeSocket: FakeSocket;

vi.mock('socket.io-client', () => ({
  io: vi.fn(() => fakeSocket),
}));

describe('KalioSDK reconnect handling', () => {
  beforeEach(() => {
    handlers.clear();
    managerHandlers.clear();
    fakeSocket = {
      recovered: false,
      connected: true,
      on: vi.fn((event: string, handler: SocketHandler) => {
        handlers.set(event, handler);
      }),
      off: vi.fn(),
      emit: vi.fn(),
      connect: vi.fn(),
      disconnect: vi.fn(),
      io: {
        on: vi.fn((event: string, handler: SocketHandler) => {
          managerHandlers.set(event, handler);
        }),
        off: vi.fn(),
      },
    };
  });

  it('does not fire app-level reconnect callbacks on the initial socket connect', () => {
    fakeSocket.connected = false;
    const sdk = new KalioSDK({ wsUrl: 'http://localhost:3016' });
    const handler = vi.fn();

    sdk.onReconnect(handler);
    handlers.get('connect')?.();

    expect(handler).not.toHaveBeenCalled();
  });

  it('fires app-level reconnect callbacks even when Socket.IO recovered packet delivery', () => {
    const sdk = new KalioSDK({ wsUrl: 'http://localhost:3016' });
    const handler = vi.fn();

    sdk.onReconnect(handler);
    handlers.get('disconnect')?.('transport close');
    fakeSocket.recovered = true;
    handlers.get('connect')?.();

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('fires app-level reconnect callbacks on manager reconnect after a disconnect', () => {
    const sdk = new KalioSDK({ wsUrl: 'http://localhost:3016' });
    const handler = vi.fn();

    sdk.onReconnect(handler);
    handlers.get('disconnect')?.('transport close');
    managerHandlers.get('reconnect')?.(1);

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('reports the current connected state when subscribing after socket connect already happened', () => {
    fakeSocket.connected = true;
    fakeSocket.recovered = true;
    const sdk = new KalioSDK({ wsUrl: 'http://localhost:3016' });
    const handler = vi.fn();

    sdk.onConnectionState(handler);

    expect(handler).toHaveBeenCalledWith({ status: 'connected', recovered: true });
  });

  it('reports connected state on manager reconnect success', () => {
    const sdk = new KalioSDK({ wsUrl: 'http://localhost:3016' });
    const handler = vi.fn();

    sdk.onConnectionState(handler);
    managerHandlers.get('reconnect_attempt')?.(1);
    fakeSocket.recovered = true;
    managerHandlers.get('reconnect')?.(1);

    expect(handler).toHaveBeenLastCalledWith({ status: 'connected', recovered: true });
  });
});
