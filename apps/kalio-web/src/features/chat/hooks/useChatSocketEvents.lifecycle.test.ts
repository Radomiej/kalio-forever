import { describe, expect, it, vi } from 'vitest';
import { reconnectSocketWhenBrowserOnline } from './useChatSocketEvents.lifecycle';

describe('reconnectSocketWhenBrowserOnline', () => {
  it('nudges reconnect with connect only when the browser reports online', () => {
    const connect = vi.fn();

    reconnectSocketWhenBrowserOnline({
      isConnected: () => false,
      isBrowserOnline: () => true,
      connect,
    });

    expect(connect).toHaveBeenCalledTimes(1);
  });

  it('does not reconnect while still offline or already connected', () => {
    const connect = vi.fn();

    reconnectSocketWhenBrowserOnline({
      isConnected: () => false,
      isBrowserOnline: () => false,
      connect,
    });
    reconnectSocketWhenBrowserOnline({
      isConnected: () => true,
      isBrowserOnline: () => true,
      connect,
    });

    expect(connect).not.toHaveBeenCalled();
  });
});
