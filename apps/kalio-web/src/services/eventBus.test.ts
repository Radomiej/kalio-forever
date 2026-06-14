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
        const configured = import.meta.env['VITE_WS_URL'] as string | undefined;
        if (configured) {
          return configured;
        }

        const backendPortByFrontendPort = new Map([
          ['5188', '3016'],
          ['5288', '3316'],
          ['6188', '4016'],
        ]);
        const backendPort = backendPortByFrontendPort.get(window.location.port);
        return backendPort
          ? `${window.location.protocol}//${window.location.hostname}:${backendPort}`
          : window.location.origin;
      })(),
    });
  });
});
