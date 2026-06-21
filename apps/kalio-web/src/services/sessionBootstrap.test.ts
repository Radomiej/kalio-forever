import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from './apiClient';
import { loadConversationSessions, loadRuntimeWatchlist } from './sessionBootstrap';

vi.mock('./apiClient', () => ({
  apiClient: {
    get: vi.fn(),
  },
}));

describe('sessionBootstrap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deduplicates in-flight conversation session loads', async () => {
    let resolveRequest!: (value: { data: Array<{ id: string }> }) => void;
    vi.mocked(apiClient.get).mockImplementationOnce(() => new Promise((resolve) => {
      resolveRequest = resolve as typeof resolveRequest;
    }));

    const first = loadConversationSessions();
    const second = loadConversationSessions();

    expect(first).toBe(second);
    expect(apiClient.get).toHaveBeenCalledTimes(1);
    expect(apiClient.get).toHaveBeenCalledWith('/api/sessions');

    resolveRequest({ data: [{ id: 'session-1' }] });

    await expect(first).resolves.toEqual([{ id: 'session-1' }]);
  });

  it('allows forced conversation session reloads', async () => {
    vi.mocked(apiClient.get)
      .mockResolvedValueOnce({ data: [{ id: 'session-1' }] })
      .mockResolvedValueOnce({ data: [{ id: 'session-2' }] });

    await expect(loadConversationSessions()).resolves.toEqual([{ id: 'session-1' }]);
    await expect(loadConversationSessions({ force: true })).resolves.toEqual([{ id: 'session-2' }]);
    expect(apiClient.get).toHaveBeenCalledTimes(2);
  });

  it('deduplicates in-flight runtime watchlist loads', async () => {
    let resolveRequest!: (value: { data: Array<{ sessionId: string; reasons: string[] }> }) => void;
    vi.mocked(apiClient.get).mockImplementationOnce(() => new Promise((resolve) => {
      resolveRequest = resolve as typeof resolveRequest;
    }));

    const first = loadRuntimeWatchlist();
    const second = loadRuntimeWatchlist();

    expect(first).toBe(second);
    expect(apiClient.get).toHaveBeenCalledTimes(1);
    expect(apiClient.get).toHaveBeenCalledWith('/api/sessions/runtime-watchlist');

    resolveRequest({ data: [{ sessionId: 'session-1', reasons: ['active'] }] });

    await expect(first).resolves.toEqual([{ sessionId: 'session-1', reasons: ['active'] }]);
  });
});
