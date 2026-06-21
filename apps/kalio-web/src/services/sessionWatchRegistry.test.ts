import { beforeEach, describe, expect, it, vi } from 'vitest';
import { eventBus } from './eventBus';
import {
  clearSessionWatchRegistry,
  identifyWatchedSession,
  replaceBaselineWatchedSessions,
  resetSessionWatchConnectionEpoch,
} from './sessionWatchRegistry';

vi.mock('./eventBus', () => ({
  eventBus: {
    identifySession: vi.fn(),
  },
}));

describe('sessionWatchRegistry', () => {
  beforeEach(() => {
    clearSessionWatchRegistry();
    vi.clearAllMocks();
  });

  it('deduplicates repeated identify calls within one connection epoch', () => {
    identifyWatchedSession('session-1', 'first', { sticky: true });
    identifyWatchedSession('session-1', 'second', { sticky: true });

    expect(eventBus.identifySession).toHaveBeenCalledTimes(1);
    expect(eventBus.identifySession).toHaveBeenCalledWith('session-1');
  });

  it('re-identifies baseline and sticky sessions after a new connection epoch starts', () => {
    replaceBaselineWatchedSessions(['root-1'], 'bootstrap');
    identifyWatchedSession('session-2', 'active', { sticky: true });
    vi.mocked(eventBus.identifySession).mockClear();

    resetSessionWatchConnectionEpoch('reconnect');

    expect(eventBus.identifySession).toHaveBeenCalledTimes(2);
    expect(eventBus.identifySession).toHaveBeenCalledWith('root-1');
    expect(eventBus.identifySession).toHaveBeenCalledWith('session-2');
  });

  it('replaces baseline watch targets instead of accumulating stale roots', () => {
    replaceBaselineWatchedSessions(['root-1'], 'bootstrap');
    vi.mocked(eventBus.identifySession).mockClear();

    replaceBaselineWatchedSessions(['root-2'], 'refresh');
    resetSessionWatchConnectionEpoch('reconnect');

    expect(eventBus.identifySession).toHaveBeenCalledWith('root-2');
    expect(eventBus.identifySession).not.toHaveBeenCalledWith('root-1');
  });
});
