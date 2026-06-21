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
let fakeSocket: FakeSocket;

vi.mock('socket.io-client', () => ({
  io: vi.fn(() => fakeSocket),
}));

describe('KalioSDK reconnect handling', () => {
  beforeEach(() => {
    handlers.clear();
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
        on: vi.fn(),
        off: vi.fn(),
      },
    };
  });

  it('fires app-level reconnect callbacks even when Socket.IO recovered packet delivery', () => {
    const sdk = new KalioSDK({ wsUrl: 'http://localhost:3016' });
    const handler = vi.fn();

    sdk.onReconnect(handler);
    fakeSocket.recovered = true;
    handlers.get('connect')?.();

    expect(handler).toHaveBeenCalledTimes(1);
  });
});
