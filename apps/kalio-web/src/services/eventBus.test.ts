import { describe, expect, it, vi } from 'vitest';

const kalioSdkMock = vi.fn();

vi.mock('@kalio/sdk', () => ({
  KalioSDK: kalioSdkMock,
}));

describe('eventBus', () => {
  it('initializes KalioSDK with the resolved websocket url', async () => {
    vi.resetModules();
    kalioSdkMock.mockClear();

    await import('./eventBus');

    expect(kalioSdkMock).toHaveBeenCalledWith({
      wsUrl: (() => {
        const backendPortByFrontendPort = new Map([
          ['5188', '3016'],
          ['5288', '3316'],
          ['6188', '4016'],
        ]);
        const backendPort = backendPortByFrontendPort.get(window.location.port);
        if (backendPort) {
          return `${window.location.protocol}//${window.location.hostname}:${backendPort}`;
        }

        const configured = import.meta.env['VITE_WS_URL'] as string | undefined;
        return configured || window.location.origin;
      })(),
    });
  });

  it('prefers the official fixed-port backend over stale build-time websocket env', async () => {
    vi.resetModules();
    kalioSdkMock.mockClear();
    vi.doMock('./backendOrigin', () => ({
      resolvePairedBackendOrigin: () => 'http://127.0.0.1:3316',
    }));

    try {
      await import('./eventBus');
    } finally {
      vi.doUnmock('./backendOrigin');
    }

    expect(kalioSdkMock).toHaveBeenCalledWith({
      wsUrl: 'http://127.0.0.1:3316',
    });
  });
});
