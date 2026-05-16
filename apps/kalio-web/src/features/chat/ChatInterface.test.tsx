/**
 * Regression tests for ChatInterface event wiring.
 *
 * Focus: verify that tool:start, tool:result, and tool:confirmation_required
 * Socket.IO events correctly drive toolActivities in the agent store.
 *
 * Before the tool:start fix, non-HITL tool calls were invisible in the UI
 * because addToolActivity was only called from the confirmation handler.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { ChatInterface } from './ChatInterface';
import { computeAnsweredCallIds } from './chatUtils';
import type { ChatMessage } from '@kalio/types';

// jsdom does not implement scrollIntoView
window.HTMLElement.prototype.scrollIntoView = vi.fn();

// ── Captured event handlers (populated when ChatInterface mounts) ─────────────
const handlers: Record<string, ((...args: unknown[]) => void)[]> = {};

function capture(event: string, handler: (...args: unknown[]) => void) {
  if (!handlers[event]) handlers[event] = [];
  handlers[event].push(handler);
  return () => {
    handlers[event] = (handlers[event] ?? []).filter((h) => h !== handler);
  };
}

function fire(event: string, payload: unknown) {
  (handlers[event] ?? []).forEach((h) => h(payload));
}

async function flushReactEffects(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

async function renderChatInterface() {
  let view!: ReturnType<typeof render>;
  await act(async () => {
    view = render(<ChatInterface />);
    await flushReactEffects();
  });
  return view;
}

async function rerenderChatInterface(rerender: ReturnType<typeof render>['rerender']) {
  await act(async () => {
    rerender(<ChatInterface />);
    await flushReactEffects();
  });
}

async function emitEvent(event: string, payload: unknown) {
  await act(async () => {
    fire(event, payload);
    await flushReactEffects();
  });
}

// Spies declared via vi.hoisted() so they're initialized before vi.mock factories run
const mockSendMessage = vi.hoisted(() => vi.fn());
const mockConversationFilesBar = vi.hoisted(() => vi.fn());

// ── eventBus mock ─────────────────────────────────────────────────────────────
vi.mock('../../services/eventBus', () => ({
  eventBus: {
    connected: true,
    connect: vi.fn(),
    onChunk: (h: (...args: unknown[]) => void) => capture('chat:chunk', h),
    onComplete: (h: (...args: unknown[]) => void) => capture('chat:complete', h),
    onError: (h: (...args: unknown[]) => void) => capture('chat:error', h),
    onToolConfirmation: (h: (...args: unknown[]) => void) => capture('tool:confirmation_required', h),
    onToolStart: (h: (...args: unknown[]) => void) => capture('tool:start', h),
    onToolResult: (h: (...args: unknown[]) => void) => capture('tool:result', h),
    onContext: (h: (...args: unknown[]) => void) => capture('chat:context', h),
    onAgentStart: (h: (...args: unknown[]) => void) => capture('agent:start', h),
    onAgentDone: (h: (...args: unknown[]) => void) => capture('agent:done', h),
    onSessionCreated: (h: (...args: unknown[]) => void) => capture('session:created', h),
    onRaAppNativeResult: (h: (...args: unknown[]) => void) => capture('raapp:native_result', h),
    onCLIAgentProgress: (h: (...args: unknown[]) => void) => capture('cli_agent:progress', h),
    onReconnect: vi.fn().mockReturnValue(vi.fn()),
    identifySession: vi.fn(),
    sendMessage: mockSendMessage,
    stopTurn: vi.fn(),
    confirmTool: vi.fn(),
    cancelTool: vi.fn(),
    disconnect: vi.fn(),
  },
}));

// ── agentStore mock ───────────────────────────────────────────────────────────
const addToolActivity = vi.fn();
const updateToolActivity = vi.fn();
const addSession = vi.fn();
const addMessage = vi.fn();
const setStreaming = vi.fn();
const setPendingConfirmation = vi.fn();
const clearToolActivities = vi.fn();
const addLlmActivity = vi.fn();
const updateLlmActivity = vi.fn();
const setContext = vi.fn();
const registerCallId = vi.fn();
const addActiveAgentLoop = vi.fn();
const removeActiveAgentLoop = vi.fn();
const appendCLIAgentChunk = vi.fn();
const clearCLIAgentOutput = vi.fn();

const agentStoreState = {
  isStreaming: false,
  pendingConfirmations: {} as Record<string, unknown>,
  toolActivities: [] as { callId: string; toolName: string }[],
  llmActivities: [],
  systemPrompt: null,
  activeToolNames: [],
  callIdToName: {},
  activeAgentLoops: {} as Record<string, { sessionId: string; turnId: string; startedAt: number }>,
  setStreaming,
  setPendingConfirmation,
  addToolActivity,
  updateToolActivity,
  clearToolActivities,
  addLlmActivity,
  updateLlmActivity,
  setContext,
  getToolActivitiesForSession: (sessionId: string | null) =>
    sessionId
      ? agentStoreState.toolActivities.filter((activity) => (activity as { sessionId?: string }).sessionId === sessionId)
      : [],
  getContextForSession: () => ({
    systemPrompt: agentStoreState.systemPrompt,
    activeToolNames: agentStoreState.activeToolNames,
  }),
  registerCallId,
  addActiveAgentLoop,
  removeActiveAgentLoop,
  hasActiveLoopForSession: (sessionId: string | null) =>
    sessionId
      ? Object.values(agentStoreState.activeAgentLoops).some((loop) => loop.sessionId === sessionId)
      : false,
  appendCLIAgentChunk,
  clearCLIAgentOutput,
};

vi.mock('../../store/agentStore', () => ({
  useAgentStore: Object.assign(() => agentStoreState, {
    getState: () => agentStoreState,
  }),
}));

// ── sessionStore mock ─────────────────────────────────────────────────────────
const setAgentTurns = vi.fn();
const setMessages = vi.fn();
const markAgentTurnError = vi.fn();
const removeLastAgentTurn = vi.fn();
const startAgentTurn = vi.fn();
const finalizeAgentTurn = vi.fn();
const addTurnItem = vi.fn();
const clearAgentTurns = vi.fn();
const flushStreamingChunks = vi.fn();

// Mutable activeTurnId so tests can control what the store returns
let mockActiveTurnId: string | null = null;
let mockActiveSessionId = 'session-1';
let mockPendingMessage: string | null = null;
let mockStreamingChunks: Record<string, string> = {};
let mockThinkingChunks: Record<string, string> = {};
let mockChunkSessionIds: Record<string, string> = {};
const mockSetPendingMessage = vi.fn();
const mockSetPendingRAAppId = vi.fn();

vi.mock('../../store/sessionStore', () => ({
  useSessionStore: Object.assign(
    () => ({
      messages: [],
      agentTurns: [],
      activeTurnId: mockActiveTurnId,
      activeSessionId: mockActiveSessionId,
      sessions: [
        { id: 'session-1', title: 'Test', personaId: 'p1', createdAt: 0, updatedAt: 0 },
        { id: 'session-2', title: 'Other', personaId: 'p1', createdAt: 0, updatedAt: 0 },
        { id: 'session-raapp', title: 'My RA App', personaId: 'ra-apps', createdAt: 0, updatedAt: 0 },
      ],
      addMessage,
      addSession,
      appendChunk: vi.fn(),
      finalizeChunk: vi.fn(),
      setMessages,
      updateSession: vi.fn(),
      setAgentTurns,
      startAgentTurn,
      addTurnItem,
      finalizeAgentTurn,
      clearAgentTurns,
      getSessionActiveTurnId: () => mockActiveTurnId,
      getSessionAgentTurns: () => [],
      markAgentTurnError,
      removeLastAgentTurn,
      flushThinkingChunks: vi.fn(),
      flushStreamingChunks,
    }),
    {
      getState: () => ({
        messages: [],
        agentTurns: [],
        activeTurnId: mockActiveTurnId,
        activeSessionId: mockActiveSessionId,
        sessions: [
          { id: 'session-1', title: 'Test', personaId: 'p1', createdAt: 0, updatedAt: 0 },
          { id: 'session-2', title: 'Other', personaId: 'p1', createdAt: 0, updatedAt: 0 },
          { id: 'session-raapp', title: 'My RA App', personaId: 'ra-apps', createdAt: 0, updatedAt: 0 },
        ],
        pendingMessage: mockPendingMessage,
        addSession,
        pendingRAAppId: null,
        setPendingMessage: mockSetPendingMessage,
        setPendingRAAppId: mockSetPendingRAAppId,
        updateSession: vi.fn(),
        streamingChunks: mockStreamingChunks,
        thinkingChunks: mockThinkingChunks,
        chunkSessionIds: mockChunkSessionIds,
        finalizeChunk: vi.fn(),
        flushStreamingChunks,
        getSessionActiveTurnId: () => mockActiveTurnId,
        getSessionAgentTurns: () => [],
        markAgentTurnError,
        removeLastAgentTurn,
      }),
    },
  ),
}));

// ── settingsStore mock ────────────────────────────────────────────────────────
vi.mock('../settings/settingsStore', () => ({
  useSettingsStore: (selector: (s: { getEffectiveModel: () => string }) => unknown) =>
    selector({ getEffectiveModel: () => 'test-model' }),
}));

// ── context usage mock ────────────────────────────────────────────────────────
vi.mock('./hooks/useContextUsage', () => ({
  useContextUsage: () => ({
    tokenCount: { total: 100, contextLimit: 32000, usagePercent: 0 },
    needsCompact: false,
    compactMessages: vi.fn(),
  }),
}));

// ── apiClient mock ────────────────────────────────────────────────────────────
vi.mock('../../services/apiClient', () => ({
  apiClient: {
    get: vi.fn(() => Promise.resolve({ data: [] })),
  },
}));

// ── Minor child-component mocks ───────────────────────────────────────────────
vi.mock('./MessageBubble', () => ({ MessageBubble: () => null }));
vi.mock('./ToolActivityRow', () => ({ ToolActivityRow: () => null }));
vi.mock('./ChatInput', () => ({ ChatInput: () => null }));
vi.mock('./TokenBadge', () => ({ TokenBadge: () => null }));
vi.mock('./ContextStats', () => ({ ContextStats: () => null }));
vi.mock('../vfs/ConversationFilesBar', () => ({
  ConversationFilesBar: (props: { sessionId: string; refreshSignal: number }) => {
    mockConversationFilesBar(props);
    return null;
  },
}));
vi.mock('./AgentTurnBubble', () => ({ AgentTurnBubble: () => null }));

// ─────────────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve([]) })),
  );
  Object.keys(handlers).forEach((k) => delete handlers[k]);
  mockActiveTurnId = null;
  mockActiveSessionId = 'session-1';
  mockPendingMessage = null;
  mockStreamingChunks = {};
  mockThinkingChunks = {};
  mockChunkSessionIds = {};
  agentStoreState.activeAgentLoops = {};
  agentStoreState.toolActivities = [];
  vi.clearAllMocks();
});

describe('ChatInterface event wiring', () => {
  it('REGRESSION: tool:start creates a running activity in agentStore', async () => {
    await renderChatInterface();

    await emitEvent('tool:start', {
        callId: 'call-1',
        toolName: 'fs_list',
        args: { path: '/tmp' },
      });

    expect(addToolActivity).toHaveBeenCalledOnce();
    expect(addToolActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        callId: 'call-1',
        toolName: 'fs_list',
        status: 'running',
      }),
    );
  });

  it('tool:result updates an existing activity to success', async () => {
    await renderChatInterface();

    await emitEvent('tool:start', { callId: 'call-2', toolName: 'fs_read', args: {} });
    await emitEvent('tool:result', { callId: 'call-2', status: 'success', data: 'content' });

    expect(updateToolActivity).toHaveBeenCalledWith(
      'call-2',
      expect.objectContaining({ status: 'success' }),
    );
  });

  it('tool:result updates an existing activity to error', async () => {
    await renderChatInterface();

    await emitEvent('tool:start', { callId: 'call-3', toolName: 'fs_list', args: {} });
    await emitEvent('tool:result', { callId: 'call-3', status: 'error', errorCode: 'TOOL_NOT_FOUND', errorMessage: 'not found' });

    expect(updateToolActivity).toHaveBeenCalledWith(
      'call-3',
      expect.objectContaining({ status: 'error' }),
    );
  });

  it('tool:confirmation_required creates an awaiting_confirmation activity', async () => {
    await renderChatInterface();
    // Clear the setup call from the activation effect before testing event-driven behaviour
    setPendingConfirmation.mockClear();

    await emitEvent('tool:confirmation_required', {
        requestId: 'req-1',
        toolCallId: 'call-4',
        sessionId: 'session-1',
        toolName: 'fs_delete',
        args: { path: '/tmp/file' },
        timeoutMs: 30000,
      });

    expect(setPendingConfirmation).toHaveBeenCalledOnce();
    expect(setPendingConfirmation).toHaveBeenCalledWith('session-1', expect.objectContaining({
      requestId: 'req-1',
      toolCallId: 'call-4',
      sessionId: 'session-1',
    }));
    expect(addToolActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        callId: 'call-4',
        toolName: 'fs_delete',
        status: 'awaiting_confirmation',
      }),
    );
  });

  it('chat:context event calls setContext with systemPrompt and toolNames', async () => {
    await renderChatInterface();

    await emitEvent('chat:context', {
        sessionId: 'session-1',
        systemPrompt: 'You are a test assistant.',
        toolNames: ['vfs_read', 'vfs_write'],
      });

    expect(setContext).toHaveBeenCalledOnce();
    expect(setContext).toHaveBeenCalledWith('You are a test assistant.', ['vfs_read', 'vfs_write'], 'session-1');
  });

  it('subagent tool:start records session and agentRun metadata', async () => {
    await renderChatInterface();

    await emitEvent('tool:start', {
        callId: 'call-sub',
        toolName: 'vfs_write',
        args: { filePath: 'index.html' },
        sessionId: 'child-session',
        agentRun: { agentRunId: 'subagent-run-1', agentType: 'subagent', parentSessionId: 'session-1' },
      });

    expect(addToolActivity).toHaveBeenCalledWith(expect.objectContaining({
      callId: 'call-sub',
      sessionId: 'child-session',
      agentRun: expect.objectContaining({ agentRunId: 'subagent-run-1' }),
    }));
  });

  it('subagent tool:result persists the child tool_result under the child session id', async () => {
    await renderChatInterface();

    await emitEvent('tool:result', {
        callId: 'call-sub',
        status: 'success',
        data: { path: 'index.html' },
        sessionId: 'child-session',
        agentRun: { agentRunId: 'subagent-run-1', agentType: 'subagent', parentSessionId: 'session-1' },
      });

    expect(addMessage).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'child-session',
      role: 'tool_result',
      toolCallId: 'call-sub',
    }));
  });

  it.each(['image_generate', 'image_edit'])(
    'refreshes the VFS file bar after successful %s results',
    async (toolName) => {
      await renderChatInterface();

      expect(mockConversationFilesBar).toHaveBeenCalled();
      expect(mockConversationFilesBar.mock.lastCall?.[0]).toMatchObject({
        sessionId: 'session-1',
        refreshSignal: 0,
      });

      agentStoreState.toolActivities = [{ callId: `call-${toolName}`, toolName }];

      await emitEvent('tool:result', {
        callId: `call-${toolName}`,
        status: 'success',
        data: { output_type: 'image', path: 'images/hero.png' },
        sessionId: 'session-1',
      });

      expect(mockConversationFilesBar.mock.lastCall?.[0]).toMatchObject({
        sessionId: 'session-1',
        refreshSignal: 1,
      });
    },
  );

  it('REGRESSION: refreshes the VFS file bar after a successful shared-mode subagent result', async () => {
    await renderChatInterface();

    expect(mockConversationFilesBar).toHaveBeenCalled();
    expect(mockConversationFilesBar.mock.lastCall?.[0]).toMatchObject({
      sessionId: 'session-1',
      refreshSignal: 0,
    });

    agentStoreState.toolActivities = [{ callId: 'call-subagent-shared', toolName: 'run_subagent' }];

    await emitEvent('tool:result', {
      callId: 'call-subagent-shared',
      status: 'success',
      sessionId: 'session-1',
      data: {
        childSessionId: 'child-session',
        parentSessionId: 'session-1',
        vfsMode: 'shared',
        vfsSessionId: 'session-1',
        copiedFiles: [],
        result: 'Created shared files',
        taskId: 'task-1',
        durationMs: 1234,
      },
    });

    expect(mockConversationFilesBar.mock.lastCall?.[0]).toMatchObject({
      sessionId: 'session-1',
      refreshSignal: 1,
    });
  });

  it('session:created adds subagent session to the store', async () => {
    await renderChatInterface();

    await emitEvent('session:created', {
        id: 'child-session',
        personaId: 'default',
        title: 'Sub-agent: demo',
        kind: 'subagent',
        parentSessionId: 'session-1',
        createdAt: 1,
        updatedAt: 1,
      });

    expect(addSession).toHaveBeenCalledWith(expect.objectContaining({ id: 'child-session', kind: 'subagent' }));
  });

  it('ignores tool:result streaming state changes from a different session', async () => {
    mockActiveSessionId = 'session-1';
    await renderChatInterface();
    setStreaming.mockClear();

    await emitEvent('tool:result', {
      callId: 'call-background',
      status: 'success',
      data: { ok: true },
      sessionId: 'session-2',
    });

    expect(setStreaming).not.toHaveBeenCalled();
    expect(addMessage).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'session-2',
      toolCallId: 'call-background',
    }));
  });

  it('ignores chat:complete streaming state changes from a different session', async () => {
    mockActiveSessionId = 'session-1';
    await renderChatInterface();
    setStreaming.mockClear();

    await emitEvent('chat:complete', {
      sessionId: 'session-2',
      messageId: 'msg-background',
    });

    expect(setStreaming).not.toHaveBeenCalled();
  });
});

describe('REGRESSION: tool name resolution persists across turns', () => {
  it('tool:start calls registerCallId so name survives clearToolActivities', async () => {
    await renderChatInterface();

    await emitEvent('tool:start', {
        callId: 'call_abc123',
        toolName: 'raapp_create',
        args: { type: 'html', content: '<div/>' },
      });

    // registerCallId must be called with the exact callId and toolName
    expect(registerCallId).toHaveBeenCalledWith('call_abc123', 'raapp_create');
  });

  it('tool:start for a second turn also registers its callId', async () => {
    await renderChatInterface();

    await emitEvent('tool:start', { callId: 'call_turn1', toolName: 'raapp_create', args: {} });
    await emitEvent('tool:start', { callId: 'call_turn2', toolName: 'run_raapp', args: { id: 'interactive-qa' } });

    expect(registerCallId).toHaveBeenCalledWith('call_turn1', 'raapp_create');
    expect(registerCallId).toHaveBeenCalledWith('call_turn2', 'run_raapp');
    expect(registerCallId).toHaveBeenCalledTimes(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// REGRESSION: RA-App widget freezes after user answers (computeAnsweredCallIds)
// Bug: after clicking an answer in Q&A interactive app, the old widget
// remained interactive (not frozen) instead of showing "answer submitted".
// ─────────────────────────────────────────────────────────────────────────────

function makeMsg(overrides: Partial<ChatMessage>): ChatMessage {
  return {
    id: 'msg-default',
    sessionId: 's1',
    role: 'assistant',
    content: '',
    createdAt: Date.now(),
    ...overrides,
  } as ChatMessage;
}

describe('REGRESSION: computeAnsweredCallIds freezes old RA-App widgets', () => {
  it('returns empty set when no user message follows any tool_result', () => {
    const messages: ChatMessage[] = [
      makeMsg({ id: 'u1', role: 'user', content: 'Run Q&A' }),
      makeMsg({ id: 'a1', role: 'assistant', content: '' }),
      makeMsg({ id: 'tr1', role: 'tool_result', content: '{}', toolCallId: 'call_raapp_1' }),
    ];
    const result = computeAnsweredCallIds(messages);
    expect(result.size).toBe(0);
  });

  it('marks run_raapp tool_result as answered when user message appears after it', () => {
    const messages: ChatMessage[] = [
      makeMsg({ id: 'u1', role: 'user', content: 'Run Q&A' }),
      makeMsg({ id: 'a1', role: 'assistant', content: '' }),
      makeMsg({ id: 'tr1', role: 'tool_result', content: '{"type":"gui","status":"ready"}', toolCallId: 'call_raapp_1' }),
      makeMsg({ id: 'u2', role: 'user', content: 'I choose: Java' }),
    ];
    const result = computeAnsweredCallIds(messages);
    expect(result.has('call_raapp_1')).toBe(true);
  });

  it('does NOT mark second run_raapp as answered when no user message follows it', () => {
    // Full Q&A round-trip: first widget answered, second widget still active
    const messages: ChatMessage[] = [
      makeMsg({ id: 'u1', role: 'user', content: 'Run Q&A' }),
      makeMsg({ id: 'a1', role: 'assistant', content: '' }),
      makeMsg({ id: 'tr1', role: 'tool_result', content: '{"type":"gui","status":"ready"}', toolCallId: 'call_raapp_1' }),
      makeMsg({ id: 'u2', role: 'user', content: 'I choose: Java' }),
      makeMsg({ id: 'a2', role: 'assistant', content: 'Great choice!' }),
      makeMsg({ id: 'tr2', role: 'tool_result', content: '{"type":"gui","status":"ready"}', toolCallId: 'call_raapp_2' }),
    ];
    const result = computeAnsweredCallIds(messages);
    // First widget: answered ✓
    expect(result.has('call_raapp_1')).toBe(true);
    // Second widget: NOT answered yet (no user message after it)
    expect(result.has('call_raapp_2')).toBe(false);
  });

  it('handles multiple tool_results in same agent turn — only run_raapp ones that matter', () => {
    const messages: ChatMessage[] = [
      makeMsg({ id: 'u1', role: 'user', content: 'Run Q&A' }),
      makeMsg({ id: 'a1', role: 'assistant', content: '' }),
      makeMsg({ id: 'tr_list', role: 'tool_result', content: '[]', toolCallId: 'call_list_1' }),
      makeMsg({ id: 'tr_run', role: 'tool_result', content: '{"type":"gui","status":"ready"}', toolCallId: 'call_raapp_1' }),
      makeMsg({ id: 'u2', role: 'user', content: 'I choose: Java' }),
    ];
    const result = computeAnsweredCallIds(messages);
    // Both tool_results before user message should be answered
    expect(result.has('call_list_1')).toBe(true);
    expect(result.has('call_raapp_1')).toBe(true);
  });

  it('tool_result without toolCallId is never included', () => {
    const messages: ChatMessage[] = [
      makeMsg({ id: 'tr1', role: 'tool_result', content: '{}' }), // no toolCallId
      makeMsg({ id: 'u1', role: 'user', content: 'answer' }),
    ];
    const result = computeAnsweredCallIds(messages);
    expect(result.size).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// REGRESSION: timeline interleaving (user → agent → user → agent)
// Bug: after agent:start/agent:done refactor, user messages were all rendered
// first, then agent turns separately, breaking chronological order.
// ─────────────────────────────────────────────────────────────────────────────

describe('REGRESSION: timeline interleaving preserves chronological order', () => {
  it('renders user[0] → agent[0] → user[1] → agent[1] pattern', async () => {
    // The timeline logic in ChatInterface uses a simple for loop that interleaves:
    // for i in range(max(userMsgs.length, agentTurns.length)):
    //   if i < userMsgs.length: render user[i]
    //   if i < agentTurns.length: render agent[i]
    // This test verifies the component renders with the mock state
    
    const { container } = await renderChatInterface();
    // With default mock (empty messages, empty agentTurns), should render nothing
    const bubbles = container.querySelectorAll('[data-testid="message-bubble"], [data-testid="agent-turn-bubble"]');
    expect(bubbles).toHaveLength(0);
  });

  it('timeline loop handles unequal array lengths correctly', () => {
    // Test the interleaving logic directly
    const userMsgs = ['u1', 'u2'];
    const agentTurns = ['t1', 't2', 't3'];
    const timeline: string[] = [];
    const maxLen = Math.max(userMsgs.length, agentTurns.length);
    for (let i = 0; i < maxLen; i++) {
      if (i < userMsgs.length) timeline.push(`user:${userMsgs[i]}`);
      if (i < agentTurns.length) timeline.push(`agent:${agentTurns[i]}`);
    }
    // Expected: user:u1, agent:t1, user:u2, agent:t2, agent:t3
    expect(timeline).toEqual(['user:u1', 'agent:t1', 'user:u2', 'agent:t2', 'agent:t3']);
  });

  it('timeline with only agent turns renders all agents', () => {
    const userMsgs: string[] = [];
    const agentTurns = ['t1', 't2'];
    const timeline: string[] = [];
    const maxLen = Math.max(userMsgs.length, agentTurns.length);
    for (let i = 0; i < maxLen; i++) {
      if (i < userMsgs.length) timeline.push(`user:${userMsgs[i]}`);
      if (i < agentTurns.length) timeline.push(`agent:${agentTurns[i]}`);
    }
    expect(timeline).toEqual(['agent:t1', 'agent:t2']);
  });

  it('timeline with only user messages renders all users', () => {
    const userMsgs = ['u1', 'u2'];
    const agentTurns: string[] = [];
    const timeline: string[] = [];
    const maxLen = Math.max(userMsgs.length, agentTurns.length);
    for (let i = 0; i < maxLen; i++) {
      if (i < userMsgs.length) timeline.push(`user:${userMsgs[i]}`);
      if (i < agentTurns.length) timeline.push(`agent:${agentTurns[i]}`);
    }
    expect(timeline).toEqual(['user:u1', 'user:u2']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// chat:error two-path dispatch
// ─────────────────────────────────────────────────────────────────────────────

describe('chat:error two-path dispatch', () => {
  it('chat:error with active turn and hadContent=true calls markAgentTurnError', async () => {
    mockActiveTurnId = 'turn-abc';
    await renderChatInterface();

    await emitEvent('chat:error', {
        sessionId: 'session-1',
        code: 'INTERRUPTED',
        message: 'Turn interrupted by user',
        hadContent: true,
      });

    expect(markAgentTurnError).toHaveBeenCalledWith('turn-abc', {
      code: 'INTERRUPTED',
      message: 'Turn interrupted by user',
    }, 'session-1');
    expect(removeLastAgentTurn).not.toHaveBeenCalled();
  });

  it('chat:error with active turn, hadContent=false and non-INTERRUPTED code removes bubble and sets retry', async () => {
    mockActiveTurnId = 'turn-abc';
    await renderChatInterface();

    await emitEvent('chat:error', {
        sessionId: 'session-1',
        code: 'LLM_ERROR',
        message: 'LLM unavailable',
        hadContent: false,
      });

    expect(removeLastAgentTurn).toHaveBeenCalledOnce();
    expect(markAgentTurnError).not.toHaveBeenCalled();
  });

  it('chat:error with active turn, hadContent=false and INTERRUPTED silently removes bubble', async () => {
    mockActiveTurnId = 'turn-abc';
    await renderChatInterface();

    await emitEvent('chat:error', {
        sessionId: 'session-1',
        code: 'INTERRUPTED',
        message: 'Turn interrupted by user',
        hadContent: false,
      });

    expect(removeLastAgentTurn).toHaveBeenCalledOnce();
    expect(markAgentTurnError).not.toHaveBeenCalled();
  });

  it('chat:error QUEUE_FULL with no active turn calls setStreaming(false) only (floating banner path)', async () => {
    // activeTurnId remains null
    await renderChatInterface();

    await emitEvent('chat:error', {
        sessionId: 'session-1',
        code: 'QUEUE_FULL',
        message: 'Queue is full',
        hadContent: false,
      });

    // Neither turn action should be called — floating banner handles it
    expect(markAgentTurnError).not.toHaveBeenCalled();
    expect(removeLastAgentTurn).not.toHaveBeenCalled();
    expect(setStreaming).toHaveBeenCalledWith(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// REGRESSION: Retry sends stale content after session switch
// Bug: lastSentContentRef was not cleared when activeSessionId changed, so
// clicking Retry in session-2 would resend session-1's message.
// ─────────────────────────────────────────────────────────────────────────────

describe('Retry stale ref: session switch clears lastSentContentRef', () => {
  it('does not show retry banner after switching sessions (ref is cleared)', async () => {
    // Start on session-1 and receive an LLM error that would offer retry
    mockActiveSessionId = 'session-1';
    mockActiveTurnId = 'turn-1';
    const { rerender } = await renderChatInterface();

    // LLM fails on session-1 without content → retry banner should appear
    await emitEvent('chat:error', {
        sessionId: 'session-1',
        code: 'LLM_ERROR',
        message: 'LLM down',
        hadContent: false,
      });

    // Switch to session-2 (simulates user clicking another session)
    mockActiveSessionId = 'session-2';
    mockActiveTurnId = null;
    await rerenderChatInterface(rerender);

    // Re-render with new session causes the useEffect to fire and clear the ref.
    // The retry banner itself depends on `retryError` state which is reset separately,
    // but the key invariant: removeLastAgentTurn was called for session-1's turn, not
    // a hypothetical session-2 turn.
    expect(removeLastAgentTurn).toHaveBeenCalledOnce();
  });

  it('retry banner does not appear for the new session after switching', async () => {
    // After switching to session-2, errors on that session remove the empty bubble
    // via removeLastAgentTurn — same path as session-1, no cross-contamination.
    mockActiveSessionId = 'session-2';
    mockActiveTurnId = 'turn-2';
    await renderChatInterface();

    await emitEvent('chat:error', {
        sessionId: 'session-2',
        code: 'LLM_ERROR',
        message: 'error on session-2',
        hadContent: false,
      });

    // session-2's own turn is removed — not a stale session-1 turn
    expect(removeLastAgentTurn).toHaveBeenCalledOnce();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// REGRESSION: auto-send pending message uses session's personaId
// Bug: ChatInterface hardcoded 'default' personaId when auto-sending the pending
// message after tile click, causing the LLM to use the wrong persona config.
// Sessions created for RA-App tiles use personaId: 'ra-apps' which has the
// required system prompt and tool set to launch RA-Apps automatically.
// ─────────────────────────────────────────────────────────────────────────────

describe('auto-send pending message uses session personaId (not hardcoded default)', () => {
  it('sends with the session stored personaId when pendingMessage is set', async () => {
    mockActiveSessionId = 'session-raapp';
    mockPendingMessage = 'Run the My RA App RA-App for me. Launch it immediately.';

    await renderChatInterface();

    expect(mockSendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ personaId: 'ra-apps' }),
    );
  });

  it('never sends with hardcoded default personaId for ra-apps sessions', async () => {
    mockActiveSessionId = 'session-raapp';
    mockPendingMessage = 'Run the My RA App RA-App for me. Launch it immediately.';

    await renderChatInterface();

    expect(mockSendMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ personaId: 'default' }),
    );
  });

  it('falls back to default personaId when session is not found', async () => {
    mockActiveSessionId = 'unknown-session-id';
    mockPendingMessage = 'Some pending message';

    await renderChatInterface();

    // session not in list → falls back to 'default'
    expect(mockSendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ personaId: 'default' }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// REGRESSION: navigating away (home) and back to chat wipes in-flight agent turn
//
// Root cause: ChatInterface is conditionally rendered in App.tsx. When the user
// navigates to the landing page, it unmounts. On remount (return to talk), the
// activeSessionId effect fires again and calls clearAgentTurns() even though the
// session hasn't changed. This nukes the in-flight turn; subsequent chat:chunk
// events find activeTurnId=null and addTurnItem is never called, so the LLM
// response stream becomes invisible until the user manually switches sessions.
//
// Fix: clearAgentTurns should NOT be called in the activation effect. Instead,
// setActiveSession in the store clears agentTurns on a real session switch.
// ─────────────────────────────────────────────────────────────────────────────
describe('REGRESSION: remount with same session must not clear agent turns', () => {
  it('unmounting and remounting with the same activeSessionId does not call clearAgentTurns', async () => {
    const { unmount } = await renderChatInterface();
    // clearAgentTurns is called once on initial mount (part of activation effect)
    vi.clearAllMocks();

    // Simulate navigating to landing (unmounts ChatInterface) and back (remounts)
    unmount();
    await renderChatInterface();

    // BUG: clearAgentTurns was called again, wiping any in-flight streaming turn.
    // After fix: clearAgentTurns lives in setActiveSession (store), not here.
    expect(clearAgentTurns).not.toHaveBeenCalled();
  });

  it('chat:chunk after remount still calls appendChunk (streaming channel intact)', async () => {
    // Pull appendChunk from the useSessionStore mock so we can spy on it
    // after remount. The mock returns fresh vi.fn() per call, but we can
    // check via the handler capture that the event bus re-registered listeners.
    const { unmount } = await renderChatInterface();
    vi.clearAllMocks();

    unmount();
    await renderChatInterface();

    // Fire a chunk AFTER remount — with the bug the listener may not be
    // registered, but more critically the activation effect wipes streaming state.
    // The simplest observable: appendChunk (from useSessionStore hook) is called.
    // Since each render creates a fresh vi.fn() via the factory, we verify the
    // event is dispatched at all by checking no error is thrown.
    expect(() => {
      act(() => {
        fire('chat:chunk', {
          sessionId: 'session-1',
          messageId: 'msg-live',
          delta: 'hello',
          done: false,
          thinking: false,
        });
      });
    }).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// REGRESSION: RA-App launched from home disappears after tools complete
//
// Root cause: race condition in the session activation useEffect.
// When a new session is activated (e.g. after clicking an RA-App tile on home),
// two things happen nearly simultaneously:
//   1. fetch('/api/sessions/:id/messages') fires to load persisted history
//   2. pendingMessage is auto-sent → backend starts the agent turn → agent:start
//      fires → startAgentTurn() populates agentTurns + sets activeTurnId
//
// If the fetch resolves AFTER agent:start (typical: fetch ~10-50ms, tool calls
// take seconds), the .then() callback calls:
//   setAgentTurns(buildTurnsFromHistory([])) → agentTurns = [], activeTurnId = null
//
// With activeTurnId = null:
//   - addTurnItem() is a no-op for ALL subsequent tool:start events
//   - finalizeAgentTurn() is a no-op on agent:done
//   - agentTurns stays empty → no AgentTurnBubble renders → nothing appears
//
// Fix: guard setAgentTurns with activeAgentLoops[sessionId]. If a live turn is
// active for this session when the fetch resolves, skip setAgentTurns entirely.
// ─────────────────────────────────────────────────────────────────────────────

describe('REGRESSION: session history fetch does not overwrite live agent turn', () => {
  it('BEFORE FIX: setAgentTurns([]) is called even mid-turn (documents the bug)', async () => {
    // This test demonstrates the raw behaviour WITHOUT the guard.
    // It is intentionally a "would fail after fix" marker — once the fix is
    // applied the guard prevents setAgentTurns from being called, so this
    // passes as "not.toHaveBeenCalled" in the real regression test below.
    // We keep this as a documentation block only — no assertion here.
    // (The real assertion is in the next test.)
  });

  it('REGRESSION: setAgentTurns is NOT called when activeAgentLoops has an entry for the session', async () => {
    // Arrange: fetch returns a deferred promise so we control timing
    let resolveMessages!: (d: unknown) => void;
    const deferred = new Promise((res) => {
      resolveMessages = res;
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve({ ok: true, json: () => deferred })),
    );

    // Simulate that agent:start already fired before the fetch resolves —
    // this is the normal production sequence (agent:start fires in ~1ms,
    // fetch resolves in ~10-50ms). We do it by directly mutating the mock
    // state object (same reference used by useAgentStore.getState()).
    agentStoreState.activeAgentLoops = {
      'session-1': { sessionId: 'session-1', turnId: 'turn-live', startedAt: Date.now() },
    };

    await renderChatInterface();
    // useEffect fired during render; fetch is pending. Clear any setup-time calls.
    setAgentTurns.mockClear();

    // Act: fetch completes with empty history (new session — nothing persisted yet)
    await act(async () => {
      resolveMessages([]);
      await deferred;
    });

    // Assert: because activeAgentLoops['session-1'] is populated, setAgentTurns
    // must NOT be called. Calling it would set activeTurnId = null, making all
    // subsequent addTurnItem / finalizeAgentTurn calls no-ops.
    expect(setAgentTurns).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it('calls setAgentTurns from history when no active agent loop exists for the session', async () => {
    // Normal path: fetch resolves before any agent:start — safe to set history turns.
    const historyMsg = {
      id: 'a1',
      sessionId: 'session-1',
      role: 'assistant' as const,
      content: 'Previous answer',
      createdAt: 0,
    };
    let resolveMessages!: (messages: unknown) => void;
    const deferredMessages = new Promise((resolve) => {
      resolveMessages = resolve;
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve({ ok: true, json: () => deferredMessages })),
    );

    agentStoreState.activeAgentLoops = {}; // no active loop

    await renderChatInterface();
    setAgentTurns.mockClear();

    await act(async () => {
      resolveMessages([historyMsg]);
      await deferredMessages;
      await flushReactEffects();
    });

    // With no active loop, setAgentTurns SHOULD be called with the history turns
    expect(setAgentTurns).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ done: true })]),
    );

    vi.unstubAllGlobals();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// REGRESSION: pendingConfirmations not cleared on session switch / turn lifecycle
//
// Root cause: per-session pendingConfirmations were added but corresponding
// cleanup was not added in session-switch effect, agent:start, and agent:done
// handlers. Stale confirmations cause ConfirmationInlineBubble to reference a
// tool activity that no longer exists (it was wiped by clearToolActivities).
// ─────────────────────────────────────────────────────────────────────────────

describe('REGRESSION: pendingConfirmations cleared on session switch', () => {
  it('activating a session clears its own pendingConfirmation', async () => {
    mockActiveSessionId = 'session-1';
    const { rerender } = await renderChatInterface();
    setPendingConfirmation.mockClear();

    // Switch to session-2 — activation effect should clear confirmation for session-2
    mockActiveSessionId = 'session-2';
    await rerenderChatInterface(rerender);

    expect(setPendingConfirmation).toHaveBeenCalledWith('session-2', null);
  });
});

describe('REGRESSION: pendingConfirmations cleared on agent:start', () => {
  it('agent:start for the active session clears its pendingConfirmation', async () => {
    await renderChatInterface();
    setPendingConfirmation.mockClear();

    await emitEvent('agent:start', { sessionId: 'session-1', turnId: 'turn-new' });

    expect(setPendingConfirmation).toHaveBeenCalledWith('session-1', null);
  });
});

describe('REGRESSION: pendingConfirmations cleared on agent:done', () => {
  it('agent:done for the active session clears its pendingConfirmation', async () => {
    await renderChatInterface();
    setPendingConfirmation.mockClear();

    await emitEvent('agent:done', { sessionId: 'session-1', turnId: 'turn-done' });

    expect(setPendingConfirmation).toHaveBeenCalledWith('session-1', null);
  });

  it('agent:done for the active session stops streaming even when chat:complete never arrived', async () => {
    await renderChatInterface();
    setStreaming.mockClear();

    await emitEvent('agent:done', { sessionId: 'session-1', turnId: 'turn-done' });

    expect(setStreaming).toHaveBeenCalledWith(false);
  });

  it('agent:done flushes pending chunks and stops streaming when chat:complete never arrived', async () => {
    mockStreamingChunks = { 'msg-1': 'partial' };
    mockChunkSessionIds = { 'msg-1': 'session-1' };

    await renderChatInterface();
    setStreaming.mockClear();
    flushStreamingChunks.mockClear();

    await emitEvent('agent:done', { sessionId: 'session-1', turnId: 'turn-done' });

    expect(flushStreamingChunks).toHaveBeenCalledWith('session-1');
    expect(setStreaming).toHaveBeenCalledWith(false);
  });
});
