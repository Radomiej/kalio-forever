import { IoAdapter } from '@nestjs/platform-socket.io';
import type { ServerOptions } from 'socket.io';

/**
 * Custom Socket.IO adapter that enables connection state recovery.
 * When a client disconnects briefly (e.g. hot-reload, network hiccup), the server
 * stores missed events for up to maxDisconnectionDuration and replays them on
 * reconnect — the client's `socket.recovered` flag will be `true` and no manual
 * state reset is needed on the frontend.
 */
export class SocketIoAdapter extends IoAdapter {
  createIOServer(port: number, options?: ServerOptions): ReturnType<IoAdapter['createIOServer']> {
    return super.createIOServer(port, {
      ...options,
      connectionStateRecovery: {
        // Store missed packets for up to 30 s — covers typical HMR restart time
        maxDisconnectionDuration: 30_000,
        skipMiddlewares: true,
      },
    });
  }
}
