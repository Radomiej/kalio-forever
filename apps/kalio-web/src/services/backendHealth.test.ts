import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { apiGet } = vi.hoisted(() => ({
  apiGet: vi.fn(),
}));

vi.mock('./apiClient', () => ({
  apiClient: {
    get: apiGet,
  },
}));

async function loadBackendHealth() {
  vi.resetModules();
  const module = await import('./backendHealth');
  return module.backendHealth;
}

describe('backendHealth', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    vi.clearAllMocks();
  });

  afterEach(async () => {
    const service = await loadBackendHealth();
    service.stop();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('notifies subscribers immediately and allows unsubscribing', async () => {
    apiGet.mockResolvedValue({});
    const service = await loadBackendHealth();
    const listener = vi.fn();

    const unsubscribe = service.subscribe(listener);
    service.reportSuccess();
    unsubscribe();
    service.reportFailure();

    expect(listener).toHaveBeenNthCalledWith(1, 'unknown', 'unknown');
    expect(listener).toHaveBeenNthCalledWith(2, 'online', 'unknown');
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('starts probing immediately, marks the backend online, and polls again on the online interval', async () => {
    apiGet.mockResolvedValue({});
    const service = await loadBackendHealth();

    service.start();
    await Promise.resolve();
    await Promise.resolve();

    expect(apiGet).toHaveBeenCalledWith('/health');
    expect(service.getState()).toBe('online');
    expect(service.isOnline()).toBe(true);

    await vi.advanceTimersByTimeAsync(30_000);
    expect(apiGet).toHaveBeenCalledTimes(2);
  });

  it('requires two consecutive probe failures before switching offline', async () => {
    apiGet.mockRejectedValue(new Error('down'));
    const service = await loadBackendHealth();

    service.start();
    await Promise.resolve();
    await Promise.resolve();

    expect(service.getState()).toBe('unknown');

    await vi.advanceTimersByTimeAsync(2_000);
    expect(service.getState()).toBe('offline');
    expect(service.isOnline()).toBe(false);
    expect(apiGet).toHaveBeenCalledTimes(2);
  });

  it('reportFailure transitions offline immediately and retries with exponential backoff', async () => {
    apiGet.mockRejectedValue(new Error('still down'));
    const service = await loadBackendHealth();

    service.start();
    service.reportFailure();

    expect(service.getState()).toBe('offline');

    await vi.advanceTimersByTimeAsync(2_000);
    expect(apiGet).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(4_000);
    expect(apiGet).toHaveBeenCalledTimes(3);
  });

  it('reportSuccess resets offline backoff and stop cancels scheduled probes', async () => {
    apiGet.mockResolvedValue({});
    const service = await loadBackendHealth();

    service.start();
    service.reportFailure();
    expect(service.getState()).toBe('offline');

    service.reportSuccess();
    expect(service.getState()).toBe('online');

    await vi.advanceTimersByTimeAsync(29_999);
    expect(apiGet).toHaveBeenCalledTimes(1);

    service.stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(apiGet).toHaveBeenCalledTimes(1);
  });
});
