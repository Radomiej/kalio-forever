import { describe, expect, it, vi } from 'vitest';
import {
  cancelToolConfirmation,
  mergePendingToolConfirmations,
  replayPendingToolConfirmations,
  resolveToolConfirmation,
} from './chat.runtime-hitl';

describe('mergePendingToolConfirmations', () => {
  it('prefers the live request while retaining durable requests absent from memory', () => {
    const live = {
      requestId: 'request-1', toolCallId: 'call-1', sessionId: 'session-1',
      toolName: 'fs_write', args: { path: 'live.md' }, timeoutMs: 0,
    };
    const durable = {
      requestId: 'request-1', toolCallId: 'call-1', sessionId: 'session-1',
      toolName: 'fs_write', args: { path: 'durable.md' }, timeoutMs: 0,
    };
    const recovered = {
      requestId: 'request-2', toolCallId: 'call-2', sessionId: 'session-1',
      toolName: 'terminal_spawn', args: { command: 'npm test' }, timeoutMs: 0,
    };

    expect(mergePendingToolConfirmations([live], [durable, recovered])).toEqual([live, recovered]);
  });
});

describe('replayPendingToolConfirmations', () => {
  it('replays durable-only requests once and skips ids already replayed', async () => {
    const live = {
      requestId: 'request-live', toolCallId: 'call-live', sessionId: 'session-1',
      toolName: 'fs_write', args: { path: 'live.md' }, timeoutMs: 0,
    };
    const durableOnly = {
      requestId: 'request-durable', toolCallId: 'call-durable', sessionId: 'session-1',
      toolName: 'terminal_spawn', args: { command: 'pnpm test' }, timeoutMs: 0,
    };
    const replay = vi.fn();

    await replayPendingToolConfirmations({
      sessionId: 'session-1',
      replayedRequestIds: new Set(['request-live']),
      toolDispatch: {
        getPendingConfirmations: vi.fn().mockReturnValue([live]),
      },
      hitlRequests: {
        listPendingToolConfirmations: vi.fn().mockResolvedValue([live, durableOnly]),
      },
      replay,
    });

    expect(replay).toHaveBeenCalledTimes(1);
    expect(replay).toHaveBeenCalledWith(durableOnly);
  });
});

describe('resolveToolConfirmation', () => {
  it('falls back to durable resume when the in-memory confirmation is gone', async () => {
    const emit = vi.fn();
    const approveAndResumeTool = vi.fn().mockResolvedValue(true);

    await resolveToolConfirmation({
      payload: { requestId: 'request-1', sessionId: 'session-1', message: 'Ship it' },
      toolDispatch: {
        resolveConfirmation: vi.fn().mockResolvedValue('not_found'),
      },
      chatService: { approveAndResumeTool },
      emit,
    });

    expect(approveAndResumeTool).toHaveBeenCalledWith('request-1', 'session-1', 'Ship it', emit);
    expect(emit).not.toHaveBeenCalledWith(
      'tool:confirmation_invalidated',
      expect.objectContaining({ requestId: 'request-1' }),
    );
  });
});

describe('cancelToolConfirmation', () => {
  it('emits a cancelled invalidation when durable cancellation succeeds after runtime eviction', async () => {
    const emit = vi.fn();

    await cancelToolConfirmation({
      payload: { requestId: 'request-1', sessionId: 'session-1', message: 'Stop this' },
      toolDispatch: {
        cancelConfirmation: vi.fn().mockResolvedValue('not_found'),
      },
      chatService: {
        cancelPendingTool: vi.fn().mockResolvedValue(true),
      },
      emit,
    });

    expect(emit).toHaveBeenCalledWith('tool:confirmation_invalidated', {
      requestId: 'request-1',
      sessionId: 'session-1',
      reason: 'cancelled',
      message: 'Stop this',
    });
  });
});
