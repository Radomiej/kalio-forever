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
      wsUrl: (import.meta.env['VITE_WS_URL'] as string | undefined) ?? window.location.origin,
    });
  });
});
