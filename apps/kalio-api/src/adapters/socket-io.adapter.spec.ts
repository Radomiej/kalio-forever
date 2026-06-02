import { IoAdapter } from '@nestjs/platform-socket.io';
import type { ServerOptions } from 'socket.io';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SocketIoAdapter } from './socket-io.adapter';

describe('SocketIoAdapter', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('enables connection state recovery when creating the Socket.IO server', () => {
    const server = { ok: true };
    const superSpy = vi.spyOn(IoAdapter.prototype, 'createIOServer').mockReturnValue(server as never);
    const adapter = new SocketIoAdapter({} as never);

    const result = adapter.createIOServer(3016, {
      cors: { origin: '*' },
      transports: ['websocket'],
    } as ServerOptions);

    expect(result).toBe(server);
    expect(superSpy).toHaveBeenCalledWith(3016, {
      cors: { origin: '*' },
      transports: ['websocket'],
      connectionStateRecovery: {
        maxDisconnectionDuration: 30_000,
        skipMiddlewares: true,
      },
    });
  });
});
