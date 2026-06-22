import { describe, expect, it, vi } from 'vitest';
import {
  handleConnectionStateEvent,
  handleSessionStatusEvent,
  materializeLiveTurnFromHydratedRuntimeState,
  runtimeSnapshotKeepsSessionLive,
  sessionStatusKeepsSessionLive,
  type ReconnectUiState,
} from './useChatSocketEvents.helpers';
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

describe('materializeLiveTurnFromHydratedRuntimeState', () => {
  it('does not revive a buffered live turn when the runtime snapshot is present but inactive', () => {
    const addActiveAgentLoop = vi.fn();
    const startAgentTurn = vi.fn();
    const setAwaitingFirstChunk = vi.fn();
    const setStreaming = vi.fn();

    materializeLiveTurnFromHydratedRuntimeState(
      {
        runtimeSnapshot: {
          sessionId: 'session-1',
          active: false,
          turnId: 'turn-stale',
          queueLength: 0,
          pendingConfirmations: [],
          pendingBudgetApprovals: [],
          toolActivities: [],
          childExecutions: [],
          updatedAt: 10,
        },
        bufferedSessionStatusSnapshots: [
          {
            sessionId: 'session-1',
            active: true,
            turnId: 'turn-buffered',
            queueLength: 0,
          },
        ],
        latestSessionStatusSnapshot: undefined,
      },
      {
        hasActiveLoopForSession: () => false,
        getSessionActiveTurnId: () => null,
        addActiveAgentLoop,
        startAgentTurn,
        setAwaitingFirstChunk,
        setStreaming,
      },
    );

    expect(addActiveAgentLoop).not.toHaveBeenCalled();
    expect(startAgentTurn).not.toHaveBeenCalled();
    expect(setAwaitingFirstChunk).not.toHaveBeenCalled();
    expect(setStreaming).not.toHaveBeenCalled();
  });

  it('falls back to buffered session status when the runtime snapshot is missing', () => {
    const addActiveAgentLoop = vi.fn();
    const startAgentTurn = vi.fn();
    const setAwaitingFirstChunk = vi.fn();
    const setStreaming = vi.fn();

    materializeLiveTurnFromHydratedRuntimeState(
      {
        runtimeSnapshot: undefined,
        bufferedSessionStatusSnapshots: [
          {
            sessionId: 'session-1',
            active: true,
            turnId: 'turn-buffered',
            queueLength: 0,
          },
        ],
        latestSessionStatusSnapshot: undefined,
      },
      {
        hasActiveLoopForSession: () => false,
        getSessionActiveTurnId: () => null,
        addActiveAgentLoop,
        startAgentTurn,
        setAwaitingFirstChunk,
        setStreaming,
      },
    );

    expect(addActiveAgentLoop).toHaveBeenCalledWith('session-1', 'turn-buffered');
    expect(startAgentTurn).toHaveBeenCalledWith('turn-buffered', 'session-1');
    expect(setAwaitingFirstChunk).toHaveBeenCalledWith(false);
    expect(setStreaming).toHaveBeenCalledWith(true, undefined, 'session-1');
  });
});

describe('terminal runtime cleanup guards', () => {
  it('treats an inactive runtime snapshot without running children or tools as terminal', () => {
    expect(runtimeSnapshotKeepsSessionLive({
      sessionId: 'session-1',
      active: false,
      turnId: 'turn-1',
      queueLength: 0,
      pendingConfirmations: [],
      pendingBudgetApprovals: [],
      toolActivities: [],
      childExecutions: [],
      updatedAt: 10,
    })).toBe(false);
  });

  it('keeps runtime snapshots live while child workflow execution is still running', () => {
    expect(runtimeSnapshotKeepsSessionLive({
      sessionId: 'session-1',
      active: false,
      turnId: 'turn-1',
      queueLength: 0,
      pendingConfirmations: [],
      pendingBudgetApprovals: [],
      toolActivities: [],
      childExecutions: [{
        id: 'flow-1',
        kind: 'agent_flow',
        parentSessionId: 'session-1',
        childSessionId: 'child-1',
        status: 'running',
        updatedAt: 10,
      }],
      updatedAt: 10,
    })).toBe(true);
  });

  it('releases a hydrated live turn when session status becomes terminal', () => {
    const removeActiveAgentLoop = vi.fn();
    const setStreaming = vi.fn();
    const setAwaitingFirstChunk = vi.fn();
    const recordSessionStatusSnapshot = vi.fn();
    const clearBufferedSessionStatusSnapshots = vi.fn();

    const payload = {
      sessionId: 'session-1',
      active: false,
      turnId: 'turn-1',
      queueLength: 0,
      run: {
        id: 'run-1',
        sessionId: 'session-1',
        turnId: 'turn-1',
        phase: 'completed' as const,
        status: 'completed' as const,
        retryCount: 0,
        safeResume: true,
        startedAt: 1,
        updatedAt: 2,
        lastHeartbeatAt: 2,
        completedAt: 2,
      },
    };

    expect(sessionStatusKeepsSessionLive(payload)).toBe(false);

    handleSessionStatusEvent(payload, {
      getActiveSessionId: () => 'session-1',
      isSessionHydrated: () => true,
      hasActiveLoopForSession: () => true,
      getSessionActiveTurnId: () => 'turn-1',
      setRecoveryNotice: vi.fn(),
      addActiveAgentLoop: vi.fn(),
      removeActiveAgentLoop,
      startAgentTurn: vi.fn(),
      setAwaitingFirstChunk,
      setStreaming,
      recordSessionStatusSnapshot,
      clearBufferedSessionStatusSnapshots,
    });

    expect(recordSessionStatusSnapshot).toHaveBeenCalledWith(payload);
    expect(clearBufferedSessionStatusSnapshots).toHaveBeenCalledWith('session-1');
    expect(removeActiveAgentLoop).toHaveBeenCalledWith('session-1');
    expect(setStreaming).toHaveBeenCalledWith(false, undefined, 'session-1');
    expect(setAwaitingFirstChunk).toHaveBeenCalledWith(false);
  });
});
