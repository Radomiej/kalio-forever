import { act, render, screen } from '@testing-library/react';
import { useRef, useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage, RuntimeActivitySnapshot } from '@kalio/types';
import { useSessionStore, type AgentTurn } from '../../../store/sessionStore';
import { useAgentStore } from '../../../store/agentStore';
import { useChatSocketEvents } from './useChatSocketEvents';
import { resolveLiveTurnState } from '../liveTurnState';
import { ChatStatusBanners } from '../ChatInterface.Parts';
import { ChatInput } from '../ChatInput';

const handlers = vi.hoisted(() => new Map<string, Set<(payload: unknown) => void>>());
vi.mock('../../../services/eventBus', () => ({ eventBus: new Proxy({ connected: true }, {
  get(target, key) {
    if (key === 'connected') return target.connected;
    if (typeof key === 'string' && key.startsWith('on')) return (handler: (payload: unknown) => void) => {
      const group = handlers.get(key) ?? new Set(); group.add(handler); handlers.set(key, group);
      return () => group.delete(handler);
    };
    return vi.fn();
  },
}) }));
vi.mock('../../../services/backendHealth', () => ({ backendHealth: { subscribe: () => () => undefined, reportSuccess: vi.fn() } }));
vi.mock('../../../services/apiClient', () => ({ apiClient: { get: vi.fn(), defaults: { baseURL: '' } }, getApiBaseUrl: () => 'http://localhost:3016' }));
vi.mock('../../voice/VoiceInputControl', () => ({ VoiceInputControl: () => null }));

function fire(event: string, payload: unknown) {
  for (const handler of [...(handlers.get(event) ?? [])]) handler(payload);
}
function message(id: string, sessionId: string, turnId: string): ChatMessage {
  return { id, sessionId, turnId, role: 'assistant', content: 'Durable answer', thinking: 'Historical reasoning', streaming: true, createdAt: 1 };
}
function turn(id: string, sessionId: string, messageId: string): AgentTurn {
  return { id, sessionId, done: false, items: [{ kind: 'thinking', messageId }, { kind: 'text', messageId }] };
}
function terminal(turnId = 't'): RuntimeActivitySnapshot {
  return { sessionId: 's', turnId, active: false, queueLength: 0, pendingConfirmations: [], pendingBudgetApprovals: [],
    toolActivities: [], childExecutions: [], updatedAt: 20 };
}
const noop = () => undefined;
const hasPending = (sessionId: string | null) => Object.values(useSessionStore.getState().chunkSessionIds).includes(sessionId ?? '');
function Consumer() {
  const state = useSessionStore(); const agent = useAgentStore();
  const [awaiting, setAwaiting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const progress = useRef<Record<string, Set<string>>>({});
  useChatSocketEvents({ hasPendingChunksForSession: hasPending, requestGeneratedTitleIfNeeded: noop,
    setAwaitingFirstChunk: setAwaiting, setConnectionState: noop, setError, setRecoveryNotice: noop,
    setVfsRefreshSignal: noop, toolArgProgressSeenRef: progress });
  const live = resolveLiveTurnState({ sessionId: state.activeSessionId, sessionMessages: state.messages,
    agentTurns: state.agentTurns, activeTurnId: state.activeTurnId, isStreaming: agent.isStreaming,
    streamingSessionId: agent.streamingSessionId, awaitingFirstChunk: awaiting,
    hasActiveLoop: agent.hasActiveLoopForSession(state.activeSessionId), queuedDepth: 0,
    activeToolActivities: agent.getToolActivitiesForSession(state.activeSessionId),
    streamingChunks: state.streamingChunks, thinkingChunks: state.thinkingChunks, chunkSessionIds: state.chunkSessionIds });
  return <><ChatStatusBanners connectionState="connected" error={error} recoveryNotice={null} retryError={null}
    onCloseError={noop} onCloseRecoveryNotice={noop} onCloseRetryError={noop} onRetry={noop} /><output data-testid="live-phase">{live.phase}</output><ChatInput disabled={false} isStreaming={live.stoppable} onSend={noop} onStop={noop} /></>;
}

beforeEach(() => {
  handlers.clear();
  useSessionStore.setState(useSessionStore.getInitialState(), true);
  useAgentStore.setState(useAgentStore.getInitialState(), true);
  const current = message('m', 's', 't'); const foreign = message('foreign', 'other', 'other-t');
  const active = turn('t', 's', 'm');
  useSessionStore.setState({ activeSessionId: 's', sessions: [{ id: 's', personaId: 'default', title: 'Chat', createdAt: 1, updatedAt: 1 }],
    hydratedSessionIds: { s: true }, messages: [current], sessionMessages: { s: [current], other: [foreign] },
    agentTurns: [active], sessionAgentTurns: { s: [active], other: [turn('other-t', 'other', 'foreign')] },
    activeTurnId: 't', sessionActiveTurnIds: { s: 't', other: 'other-t' },
    thinkingChunks: { m: 'Final reasoning', foreign: 'Foreign live reasoning' },
    streamingChunks: { foreign: 'Foreign live answer' }, chunkSessionIds: { m: 's', foreign: 'other' } });
  useAgentStore.getState().addActiveAgentLoop('s', 't');
  useAgentStore.getState().setStreaming(true, undefined, 's');
});

describe('terminal fallback through actual socket handlers, stores and composer', () => {
  it.each(['onRuntimeActivitySnapshot', 'onSessionStatus'])('%s without agent:done releases the composer and keeps genuine history', (event) => {
    render(<Consumer />);
    expect(screen.getByRole('button', { name: 'Stop agent' })).toBeInTheDocument();
    act(() => fire(event, terminal()));
    expect(screen.getByTestId('live-phase')).toHaveTextContent('idle');
    expect(screen.queryByRole('button', { name: 'Stop agent' })).not.toBeInTheDocument();
    const state = useSessionStore.getState();
    expect(state.getSessionMessages('s')[0]).toMatchObject({ content: 'Durable answer', thinking: 'Final reasoning', streaming: false });
    expect(state.thinkingChunks).toEqual({ foreign: 'Foreign live reasoning' });
    expect(state.streamingChunks).toEqual({ foreign: 'Foreign live answer' });
    const durable = state.getSessionMessages('s');
    act(() => fire('onAgentDone', { sessionId: 's', turnId: 't' }));
    expect(useSessionStore.getState().getSessionMessages('s')).toEqual(durable);
    expect(useSessionStore.getState().thinkingChunks.foreign).toBe('Foreign live reasoning');
    expect(screen.queryByRole('button', { name: 'Stop agent' })).not.toBeInTheDocument();
  });
  it.each(['onRuntimeActivitySnapshot', 'onSessionStatus'])('%s flushes only the bound older turn and preserves newer-turn and other-session chunks', (event) => {
    const state = useSessionStore.getState();
    const newer = message('new', 's', 'new-t'); const newTurn = turn('new-t', 's', 'new');
    useSessionStore.setState({ messages: [...state.messages, newer], sessionMessages: { ...state.sessionMessages, s: [...state.messages, newer] },
      agentTurns: [...state.agentTurns, newTurn], sessionAgentTurns: { ...state.sessionAgentTurns, s: [...state.agentTurns, newTurn] },
      activeTurnId: 'new-t', sessionActiveTurnIds: { ...state.sessionActiveTurnIds, s: 'new-t' },
      thinkingChunks: { ...state.thinkingChunks, new: 'New live reasoning' },
      streamingChunks: { ...state.streamingChunks, new: 'New live answer' }, chunkSessionIds: { ...state.chunkSessionIds, new: 's' } });
    render(<Consumer />);
    act(() => fire(event, terminal()));
    act(() => fire('onAgentDone', { sessionId: 's', turnId: 't' }));
    const after = useSessionStore.getState();
    expect(after.thinkingChunks.m).toBeUndefined();
    expect(after.thinkingChunks.new).toBe('New live reasoning'); expect(after.streamingChunks.new).toBe('New live answer');
    expect(after.thinkingChunks.foreign).toBe('Foreign live reasoning');
    expect(after.getSessionActiveTurnId('s')).toBe('new-t');
    expect(screen.getByRole('button', { name: 'Stop agent' })).toBeInTheDocument();
  });
  it('persists final streamed text without erasing already-durable thinking', () => {
    const state = useSessionStore.getState();
    useSessionStore.setState({ thinkingChunks: { foreign: state.thinkingChunks.foreign },
      streamingChunks: { ...state.streamingChunks, m: 'Final streamed answer' } });
    render(<Consumer />);
    act(() => fire('onSessionStatus', terminal()));
    expect(useSessionStore.getState().getSessionMessages('s')[0]).toMatchObject({
      content: 'Final streamed answer', thinking: 'Historical reasoning', streaming: false,
    });
    expect(screen.getByTestId('live-phase')).toHaveTextContent('idle');
  });
  it('reconciles a background terminal session without clearing active-session chunks', () => {
    render(<Consumer />);
    act(() => fire('onRuntimeActivitySnapshot', { ...terminal('other-t'), sessionId: 'other' }));
    const state = useSessionStore.getState();
    expect(state.thinkingChunks.foreign).toBeUndefined(); expect(state.streamingChunks.foreign).toBeUndefined();
    expect(state.thinkingChunks.m).toBe('Final reasoning');
    expect(state.getSessionMessages('other')[0]).toMatchObject({ content: 'Foreign live answer', thinking: 'Foreign live reasoning' });
    expect(state.getSessionActiveTurnId('s')).toBe('t');
    expect(screen.getByRole('button', { name: 'Stop agent' })).toBeInTheDocument();
  });
  it('does not discard unbound chunks just because they share a terminal session', () => {
    const state = useSessionStore.getState();
    useSessionStore.setState({ thinkingChunks: { ...state.thinkingChunks, unbound: 'Unresolved owner' },
      chunkSessionIds: { ...state.chunkSessionIds, unbound: 's' } });
    render(<Consumer />);
    act(() => fire('onRuntimeActivitySnapshot', terminal()));
    expect(useSessionStore.getState().thinkingChunks.m).toBeUndefined();
    expect(useSessionStore.getState().thinkingChunks.unbound).toBe('Unresolved owner');
  });
  it.each(['onRuntimeActivitySnapshot', 'onSessionStatus'])('%s without a turn ID accepts authoritative session idle but infers no chunk ownership', (event) => {
    useSessionStore.setState({ thinkingChunks: {}, streamingChunks: {}, chunkSessionIds: {} });
    render(<Consumer />);
    act(() => fire(event, { ...terminal(), turnId: undefined }));
    expect(useSessionStore.getState().getSessionActiveTurnId('s')).toBeNull();
    expect(screen.getByTestId('live-phase')).toHaveTextContent('idle');
    expect(useSessionStore.getState().getSessionMessages('s')[0].thinking).toBe('Historical reasoning');
  });
  it('does not release or flush from a terminal payload rejected by the runtime revision guard', () => {
    render(<Consumer />);
    const run: NonNullable<RuntimeActivitySnapshot['run']> = { id: 'run', sessionId: 's', turnId: 't', revision: 3, phase: 'tool_running', status: 'active',
      retryCount: 0, safeResume: true, startedAt: 1, updatedAt: 10, lastHeartbeatAt: 10 };
    act(() => fire('onRuntimeActivitySnapshot', { ...terminal(), active: true, run }));
    expect(useAgentStore.getState().getRuntimeActivitySnapshot('s')?.run?.revision).toBe(3);
    act(() => fire('onRuntimeActivitySnapshot', { ...terminal(), updatedAt: 100,
      run: { ...run, revision: 2, status: 'completed', phase: 'completed' } }));
    expect(useSessionStore.getState().thinkingChunks.m).toBe('Final reasoning');
    expect(useAgentStore.getState().getRuntimeActivitySnapshot('s')?.run?.revision).toBe(3);
    expect(useSessionStore.getState().getSessionActiveTurnId('s')).toBe('t');
    expect(screen.getByRole('button', { name: 'Stop agent' })).toBeInTheDocument();
  });
});

it('surfaces a runtime image-capability rejection in the active chat error banner', () => {
  render(<Consumer />);
  const message = 'This Devin runtime does not accept image attachments. Choose another runtime or remove the image.';
  act(() => fire('onError', { sessionId: 's', code: 'LLM_ERROR', message, hadContent: false }));
  expect(screen.getByTestId('chat-error')).toHaveRole('alert');
  expect(screen.getByTestId('chat-error')).toHaveTextContent(message);
});
