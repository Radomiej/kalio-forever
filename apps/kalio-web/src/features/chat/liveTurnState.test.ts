import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '@kalio/types';
import type { AgentTurn } from '../../store/sessionStore';
import { resolveLiveTurnState } from './liveTurnState';

function message(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'message-1',
    sessionId: 'session-1',
    role: 'assistant',
    content: '',
    createdAt: 1,
    ...overrides,
  } as ChatMessage;
}

function turn(overrides: Partial<AgentTurn> = {}): AgentTurn {
  return {
    id: 'turn-1',
    sessionId: 'session-1',
    items: [],
    done: false,
    ...overrides,
  };
}

describe('resolveLiveTurnState', () => {
  it('returns pending and renders an optimistic placeholder before the first chunk', () => {
    const state = resolveLiveTurnState({
      sessionId: 'session-1',
      sessionMessages: [message({ id: 'user-1', role: 'user', content: 'Hello' })],
      agentTurns: [],
      activeTurnId: null,
      isStreaming: true,
      streamingSessionId: 'session-1',
      awaitingFirstChunk: true,
      hasActiveLoop: false,
      queuedDepth: 0,
      activeToolActivities: [],
      streamingChunks: {},
      thinkingChunks: {},
      chunkSessionIds: {},
    });

    expect(state.phase).toBe('pending');
    expect(state.stoppable).toBe(true);
    expect(state.showPlaceholderBubble).toBe(true);
  });

  it('switches to thinking when the session has a live thinking chunk', () => {
    const state = resolveLiveTurnState({
      sessionId: 'session-1',
      sessionMessages: [message({ id: 'assistant-1' })],
      agentTurns: [],
      activeTurnId: null,
      isStreaming: true,
      streamingSessionId: 'session-1',
      awaitingFirstChunk: false,
      hasActiveLoop: true,
      queuedDepth: 0,
      activeToolActivities: [],
      streamingChunks: {},
      thinkingChunks: { 'assistant-1': 'Let me think.' },
      chunkSessionIds: { 'assistant-1': 'session-1' },
    });

    expect(state.phase).toBe('thinking');
    expect(state.previewText).toBe('Let me think.');
  });

  it('switches to streaming_text when the first visible answer chunk arrives', () => {
    const state = resolveLiveTurnState({
      sessionId: 'session-1',
      sessionMessages: [message({ id: 'assistant-1' })],
      agentTurns: [],
      activeTurnId: null,
      isStreaming: true,
      streamingSessionId: 'session-1',
      awaitingFirstChunk: false,
      hasActiveLoop: true,
      queuedDepth: 0,
      activeToolActivities: [],
      streamingChunks: { 'assistant-1': 'Partial answer' },
      thinkingChunks: {},
      chunkSessionIds: { 'assistant-1': 'session-1' },
    });

    expect(state.phase).toBe('streaming_text');
    expect(state.previewText).toBe('Partial answer');
  });

  it('switches to running_tool when a session tool is active', () => {
    const state = resolveLiveTurnState({
      sessionId: 'session-1',
      sessionMessages: [message({ id: 'user-1', role: 'user', content: 'Read the repo' })],
      agentTurns: [],
      activeTurnId: null,
      isStreaming: true,
      streamingSessionId: 'session-1',
      awaitingFirstChunk: false,
      hasActiveLoop: true,
      queuedDepth: 0,
      activeToolActivities: [{
        callId: 'call-1',
        toolName: 'fs_read',
        args: {},
        sessionId: 'session-1',
        status: 'running',
        startedAt: 1,
      }],
      streamingChunks: {},
      thinkingChunks: {},
      chunkSessionIds: {},
    });

    expect(state.phase).toBe('running_tool');
    expect(state.toolName).toBe('fs_read');
  });

  it('keeps the optimistic placeholder visible while the turn has only live tool activity', () => {
    const state = resolveLiveTurnState({
      sessionId: 'session-1',
      sessionMessages: [message({ id: 'user-1', role: 'user', content: 'Inspect the repo' })],
      agentTurns: [turn({ items: [{ kind: 'tool', callId: 'call-1' }] })],
      activeTurnId: 'turn-1',
      isStreaming: true,
      streamingSessionId: 'session-1',
      awaitingFirstChunk: false,
      hasActiveLoop: true,
      queuedDepth: 0,
      activeToolActivities: [{
        callId: 'call-1',
        toolName: 'fs_read',
        args: {},
        sessionId: 'session-1',
        status: 'running',
        startedAt: 1,
      }],
      streamingChunks: {},
      thinkingChunks: {},
      chunkSessionIds: {},
    });

    expect(state.phase).toBe('running_tool');
    expect(state.showPlaceholderBubble).toBe(true);
  });

  it('hides the optimistic placeholder once an incomplete turn has visible items', () => {
    const state = resolveLiveTurnState({
      sessionId: 'session-1',
      sessionMessages: [message({ id: 'assistant-1' })],
      agentTurns: [turn({ items: [{ kind: 'text', messageId: 'assistant-1' }] })],
      activeTurnId: 'turn-1',
      isStreaming: true,
      streamingSessionId: 'session-1',
      awaitingFirstChunk: false,
      hasActiveLoop: true,
      queuedDepth: 0,
      activeToolActivities: [],
      streamingChunks: { 'assistant-1': 'Visible text' },
      thinkingChunks: {},
      chunkSessionIds: { 'assistant-1': 'session-1' },
    });

    expect(state.phase).toBe('streaming_text');
    expect(state.showPlaceholderBubble).toBe(false);
  });

  it('returns idle when there is no live signal for the session', () => {
    const state = resolveLiveTurnState({
      sessionId: 'session-1',
      sessionMessages: [],
      agentTurns: [turn({ done: true })],
      activeTurnId: null,
      isStreaming: false,
      streamingSessionId: null,
      awaitingFirstChunk: false,
      hasActiveLoop: false,
      queuedDepth: 0,
      activeToolActivities: [],
      streamingChunks: {},
      thinkingChunks: {},
      chunkSessionIds: {},
    });

    expect(state.phase).toBe('idle');
    expect(state.stoppable).toBe(false);
    expect(state.showPlaceholderBubble).toBe(false);
  });

  it('does not treat a stale hydrated activeTurnId without runtime activity as a live turn', () => {
    const state = resolveLiveTurnState({
      sessionId: 'session-1',
      sessionMessages: [],
      agentTurns: [turn({ done: false })],
      activeTurnId: 'turn-1',
      isStreaming: false,
      streamingSessionId: null,
      awaitingFirstChunk: false,
      hasActiveLoop: false,
      queuedDepth: 0,
      activeToolActivities: [],
      streamingChunks: {},
      thinkingChunks: {},
      chunkSessionIds: {},
    });

    expect(state.phase).toBe('idle');
    expect(state.stoppable).toBe(false);
    expect(state.showPlaceholderBubble).toBe(false);
  });

  it('ignores streaming that belongs to another session', () => {
    const state = resolveLiveTurnState({
      sessionId: 'session-2',
      sessionMessages: [],
      agentTurns: [],
      activeTurnId: null,
      isStreaming: true,
      streamingSessionId: 'session-1',
      awaitingFirstChunk: false,
      hasActiveLoop: false,
      queuedDepth: 0,
      activeToolActivities: [],
      streamingChunks: {},
      thinkingChunks: {},
      chunkSessionIds: {},
    });

    expect(state.phase).toBe('idle');
    expect(state.showPlaceholderBubble).toBe(false);
  });

  it('keeps the placeholder visible for a running workflow envelope turn', () => {
    const state = resolveLiveTurnState({
      sessionId: 'session-1',
      sessionMessages: [message({
        id: 'assistant-1',
        architectureRun: {
          runId: 'run-1',
          schemaId: 'strategic-decision-council',
          status: 'running',
          trace: [],
          routeHops: [],
          hostProjectionKind: 'workflow-envelope',
        },
      })],
      agentTurns: [turn({
        turnKind: 'workflow-envelope',
        items: [{ kind: 'text', messageId: 'assistant-1' }],
        done: false,
      })],
      activeTurnId: 'turn-1',
      isStreaming: false,
      streamingSessionId: null,
      awaitingFirstChunk: false,
      hasActiveLoop: false,
      queuedDepth: 0,
      activeToolActivities: [],
      streamingChunks: {},
      thinkingChunks: {},
      chunkSessionIds: {},
    });

    expect(state.phase).toBe('pending');
    expect(state.workflowActive).toBe(true);
    expect(state.showPlaceholderBubble).toBe(true);
  });
});
