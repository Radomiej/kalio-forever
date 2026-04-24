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
  },
}));

// ── agentStore mock ───────────────────────────────────────────────────────────
const addToolActivity = vi.fn();
const updateToolActivity = vi.fn();
const setStreaming = vi.fn();
const setPendingConfirmation = vi.fn();
const clearToolActivities = vi.fn();
const addLlmActivity = vi.fn();
const updateLlmActivity = vi.fn();

vi.mock('../../store/agentStore', () => ({
  useAgentStore: () => ({
    isStreaming: false,
    pendingConfirmation: null,
    toolActivities: [],
    llmActivities: [],
    setStreaming,
    setPendingConfirmation,
    addToolActivity,
    updateToolActivity,
    clearToolActivities,
    addLlmActivity,
    updateLlmActivity,
  }),
}));

// ── sessionStore mock ─────────────────────────────────────────────────────────
vi.mock('../../store/sessionStore', () => ({
  useSessionStore: Object.assign(
    () => ({
      messages: [],
      activeSessionId: 'session-1',
      sessions: [{ id: 'session-1', title: 'Test', personaId: 'p1', createdAt: 0, updatedAt: 0 }],
      addMessage: vi.fn(),
      appendChunk: vi.fn(),
      finalizeChunk: vi.fn(),
      setMessages: vi.fn(),
      updateSession: vi.fn(),
    }),
    {
      getState: () => ({
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
});
