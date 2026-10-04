import { renderHook } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { useTurnRuntimeProvider } from './useTurnRuntimeProvider';

const state = vi.hoisted(() => ({
  turns: [] as { id: string; sessionId: string; runtimeProvider?: string }[],
  run: undefined as { turnId: string; sessionId: string; provider?: string } | undefined,
}));
vi.mock('../../store/sessionStore', () => ({ useSessionStore: (selector: (value: unknown) => unknown) => selector({ sessionAgentTurns: { session: state.turns } }) }));
vi.mock('../../store/agentStore', () => ({ useAgentStore: (selector: (value: unknown) => unknown) => selector({ runtimeActivitySnapshots: { session: { run: state.run } } }) }));
beforeEach(() => { state.turns = []; state.run = undefined; });
it('uses the recorded provider instead of a different current turn', () => {
  state.turns = [{ id: 'turn', sessionId: 'session', runtimeProvider: 'devin-cli-acp' }];
  state.run = { turnId: 'new-turn', sessionId: 'session', provider: 'codex-app-server' };
  expect(renderHook(() => useTurnRuntimeProvider('session', 'turn')).result.current).toBe('devin-cli-acp');
});
it('uses a live snapshot only for the exact session and turn', () => {
  state.run = { turnId: 'turn', sessionId: 'session', provider: 'codex-app-server' };
  expect(renderHook(() => useTurnRuntimeProvider('session', 'turn')).result.current).toBe('codex-app-server');
});
it('does not infer a provider from another turn or session', () => {
  state.turns = [{ id: 'turn', sessionId: 'other', runtimeProvider: 'devin-cli-acp' }];
  state.run = { turnId: 'other-turn', sessionId: 'session', provider: 'codex-app-server' };
  expect(renderHook(() => useTurnRuntimeProvider('session', 'turn')).result.current).toBeUndefined();
});
