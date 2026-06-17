import { describe, expect, it } from 'vitest';
import { handleConnectionStateEvent, type ReconnectUiState } from './useChatSocketEvents.helpers';
import type { ChatConnectionState } from '../ChatInterface.Parts';

function runConnectionEventSequence(
  initialConnectionState: ChatConnectionState,
  reconnectUiState: ReconnectUiState,
  events: Array<{ status: ChatConnectionState; recovered?: boolean }>,
) {
  let connectionState = initialConnectionState;
  let reconnectState = reconnectUiState;
  const notices: string[] = [];

  for (const event of events) {
    handleConnectionStateEvent(event, {
      getConnectionState: () => connectionState,
      getReconnectUiState: () => reconnectState,
      setReconnectUiState: (value) => {
        reconnectState = value;
      },
      setConnectionState: (value) => {
        connectionState = value;
      },
      setRecoveryNotice: (value) => {
        notices.push(value);
      },
    });
  }

  return { connectionState, reconnectState, notices };
}

describe('handleConnectionStateEvent', () => {
  it('does not show reconnect banners on initial recovered connect', () => {
    const result = runConnectionEventSequence(
      'connecting',
      { hasConnectedOnce: false, hadRealDisconnect: false },
      [{ status: 'connected', recovered: true }],
    );

    expect(result.notices).toEqual([]);
    expect(result.reconnectState).toEqual({
      hasConnectedOnce: true,
      hadRealDisconnect: false,
    });
  });

  it('shows reconnect and recovered banners only after a real disconnect', () => {
    const result = runConnectionEventSequence(
      'connected',
      { hasConnectedOnce: true, hadRealDisconnect: false },
      [
        { status: 'reconnecting' },
        { status: 'connected', recovered: true },
      ],
    );

    expect(result.notices).toEqual([
      'Connection dropped. Reconnecting and preserving this session.',
      'Recovered missed stream events after reconnect.',
    ]);
    expect(result.reconnectState).toEqual({
      hasConnectedOnce: true,
      hadRealDisconnect: false,
    });
  });

  it('suppresses reconnect banners for reconnecting-before-first-connect startup noise', () => {
    const result = runConnectionEventSequence(
      'connecting',
      { hasConnectedOnce: false, hadRealDisconnect: false },
      [
        { status: 'reconnecting' },
        { status: 'connected', recovered: true },
      ],
    );

    expect(result.notices).toEqual([]);
  });
});
