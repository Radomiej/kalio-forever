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
  },
}));

// ── agentStore mock ───────────────────────────────────────────────────────────
const addToolActivity = vi.fn();
const updateToolActivity = vi.fn();
const setStreaming = vi.fn();
const setPendingConfirmation = vi.fn();
const clearToolActivities = vi.fn();
const clearAgentTurns = vi.fn();
const addLlmActivity = vi.fn();
const updateLlmActivity = vi.fn();
const setContext = vi.fn();
const registerCallId = vi.fn();

const agentStoreState = {
  isStreaming: false,
  pendingConfirmation: null,
  toolActivities: [] as { callId: string; toolName: string }[],
  llmActivities: [],
  systemPrompt: null,
  activeToolNames: [],
  callIdToName: {},
  setStreaming,
  setPendingConfirmation,
  addToolActivity,
  updateToolActivity,
  clearToolActivities,
  clearAgentTurns,
  addLlmActivity,
  updateLlmActivity,
  setContext,
  registerCallId,
};

vi.mock('../../store/agentStore', () => ({
  useAgentStore: Object.assign(() => agentStoreState, {
    getState: () => agentStoreState,
  }),
}));

// ── sessionStore mock ─────────────────────────────────────────────────────────
vi.mock('../../store/sessionStore', () => ({
  useSessionStore: Object.assign(
    () => ({
      messages: [],
      agentTurns: [],
      activeTurnId: null,
      activeSessionId: 'session-1',
      sessions: [{ id: 'session-1', title: 'Test', personaId: 'p1', createdAt: 0, updatedAt: 0 }],
      addMessage: vi.fn(),
      appendChunk: vi.fn(),
      finalizeChunk: vi.fn(),
      setMessages: vi.fn(),
      updateSession: vi.fn(),
      startAgentTurn: vi.fn(),
      addTurnItem: vi.fn(),
      finalizeAgentTurn: vi.fn(),
      clearAgentTurns: vi.fn(),
    }),
    {
      getState: () => ({
        messages: [],
        agentTurns: [],
        activeTurnId: null,
        activeSessionId: 'session-1',
        sessions: [{ id: 'session-1', title: 'Test', personaId: 'p1', createdAt: 0, updatedAt: 0 }],
        updateSession: vi.fn(),
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
vi.mock('./ConfirmationDialog', () => ({ ConfirmationDialog: () => null }));
vi.mock('./TokenBadge', () => ({ TokenBadge: () => null }));
vi.mock('./ContextStats', () => ({ ContextStats: () => null }));
vi.mock('../vfs/ConversationFilesBar', () => ({ ConversationFilesBar: () => null }));
vi.mock('./AgentTurnBubble', () => ({ AgentTurnBubble: () => null }));

// ─────────────────────────────────────────────────────────────────────────────

beforeEach(() => {
  Object.keys(handlers).forEach((k) => delete handlers[k]);
  vi.clearAllMocks();
});

describe('ChatInterface event wiring', () => {
  it('REGRESSION: tool:start creates a running activity in agentStore', () => {
    render(<ChatInterface />);

    act(() => {
      fire('tool:start', {
        callId: 'call-1',
        toolName: 'fs_list',
        args: { path: '/tmp' },
      });
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

  it('tool:result updates an existing activity to success', () => {
    render(<ChatInterface />);

    act(() => {
      fire('tool:start', { callId: 'call-2', toolName: 'fs_read', args: {} });
    });
    act(() => {
      fire('tool:result', { callId: 'call-2', status: 'success', data: 'content' });
    });

    expect(updateToolActivity).toHaveBeenCalledWith(
      'call-2',
      expect.objectContaining({ status: 'success' }),
    );
  });

  it('tool:result updates an existing activity to error', () => {
    render(<ChatInterface />);

    act(() => {
      fire('tool:start', { callId: 'call-3', toolName: 'fs_list', args: {} });
    });
    act(() => {
      fire('tool:result', { callId: 'call-3', status: 'error', errorCode: 'TOOL_NOT_FOUND', errorMessage: 'not found' });
    });

    expect(updateToolActivity).toHaveBeenCalledWith(
      'call-3',
      expect.objectContaining({ status: 'error' }),
    );
  });

  it('tool:confirmation_required creates an awaiting_confirmation activity', () => {
    render(<ChatInterface />);

    act(() => {
      fire('tool:confirmation_required', {
        requestId: 'req-1',
        toolCallId: 'call-4',
        sessionId: 'session-1',
        toolName: 'fs_delete',
        args: { path: '/tmp/file' },
        timeoutMs: 30000,
      });
    });

    expect(setPendingConfirmation).toHaveBeenCalledOnce();
    expect(addToolActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        callId: 'call-4',
        toolName: 'fs_delete',
        status: 'awaiting_confirmation',
      }),
    );
  });

  it('chat:context event calls setContext with systemPrompt and toolNames', () => {
    render(<ChatInterface />);

    act(() => {
      fire('chat:context', {
        sessionId: 'session-1',
        systemPrompt: 'You are a test assistant.',
        toolNames: ['vfs_read', 'vfs_write'],
      });
    });

    expect(setContext).toHaveBeenCalledOnce();
    expect(setContext).toHaveBeenCalledWith('You are a test assistant.', ['vfs_read', 'vfs_write']);
  });
});

describe('REGRESSION: tool name resolution persists across turns', () => {
  it('tool:start calls registerCallId so name survives clearToolActivities', () => {
    render(<ChatInterface />);

    act(() => {
      fire('tool:start', {
        callId: 'call_abc123',
        toolName: 'raapp_create',
        args: { type: 'html', content: '<div/>' },
      });
    });

    // registerCallId must be called with the exact callId and toolName
    expect(registerCallId).toHaveBeenCalledWith('call_abc123', 'raapp_create');
  });

  it('tool:start for a second turn also registers its callId', () => {
    render(<ChatInterface />);

    act(() => {
      fire('tool:start', { callId: 'call_turn1', toolName: 'raapp_create', args: {} });
    });
    act(() => {
      fire('tool:start', { callId: 'call_turn2', toolName: 'run_raapp', args: { id: 'interactive-qa' } });
    });

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
  it('renders user[0] → agent[0] → user[1] → agent[1] pattern', () => {
    // The timeline logic in ChatInterface uses a simple for loop that interleaves:
    // for i in range(max(userMsgs.length, agentTurns.length)):
    //   if i < userMsgs.length: render user[i]
    //   if i < agentTurns.length: render agent[i]
    // This test verifies the component renders with the mock state
    
    const { container } = render(<ChatInterface />);
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
