/**
 * Behavioral tests for LiveToolCallBubble — inline confirmation bubble.
 *
 * Covers:
 * - awaiting_confirmation renders Confirm/Cancel buttons (matching session)
 * - awaiting_confirmation with no matching store entry renders only the icon (other session)
 * - args collapsed by default, shows truncated preview
 * - expand toggle reveals full scrollable args list
 * - Confirm button calls eventBus.confirmTool + setPendingConfirmation(sessionId, null)
 * - Cancel button calls eventBus.cancelTool + setPendingConfirmation(sessionId, null)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { HistoryToolCallBubble, LiveToolCallBubble } from './ToolCallBubble';
import type { ToolActivity } from '../../store/agentStore';
import type { ToolConfirmationRequest } from '@kalio/types';

// ── mocks ─────────────────────────────────────────────────────────────────────

const mockSetPendingConfirmation = vi.fn();
const mockUpdateToolActivity = vi.fn();
let mockPendingConfirmations: Record<string, ToolConfirmationRequest> = {};
let mockActiveSessionId = 'session-1';

vi.mock('../../store/agentStore', () => ({
  useAgentStore: (selector: (s: unknown) => unknown) =>
    selector({
      pendingConfirmations: mockPendingConfirmations,
      setPendingConfirmation: mockSetPendingConfirmation,
      updateToolActivity: mockUpdateToolActivity,
      setCanvasOpen: vi.fn(),
      cliAgentOutput: {},
    }),
}));

vi.mock('../../store/sessionStore', () => ({
  useSessionStore: (selector: (s: { activeSessionId: string }) => unknown) =>
    selector({ activeSessionId: mockActiveSessionId }),
}));

const { mockConfirmTool, mockCancelTool } = vi.hoisted(() => ({
  mockConfirmTool: vi.fn(),
  mockCancelTool: vi.fn(),
}));

vi.mock('../../services/eventBus', () => ({
  eventBus: {
    confirmTool: mockConfirmTool,
    cancelTool: mockCancelTool,
  },
}));

vi.mock('../raapp/RAAppRenderer', () => ({ RAAppRenderer: () => null }));
vi.mock('./TerminalOutputBlock', () => ({ TerminalOutputBlock: () => null }));
vi.mock('./LiveCLIAgentBlock', () => ({ LiveCLIAgentBlock: () => null }));

// ── helpers ───────────────────────────────────────────────────────────────────

function makeActivity(overrides: Partial<ToolActivity> = {}): ToolActivity {
  return {
    callId: 'call-1',
    toolName: 'vfs_write',
    args: { path: '/tmp/file.txt', content: 'hello world' },
    status: 'awaiting_confirmation',
    startedAt: Date.now(),
    ...overrides,
  };
}

function makeConfirmation(sessionId = 'session-1', callId = 'call-1'): ToolConfirmationRequest {
  return {
    requestId: 'req-1',
    toolCallId: callId,
    sessionId,
    toolName: 'vfs_write',
    args: { path: '/tmp/file.txt', content: 'hello world' },
    timeoutMs: 30000,
  };
}

beforeEach(() => {
  mockPendingConfirmations = {};
  mockActiveSessionId = 'session-1';
  vi.clearAllMocks();
});

// ── tests ─────────────────────────────────────────────────────────────────────

describe('LiveToolCallBubble — awaiting_confirmation', () => {
  it('renders Confirm and Cancel buttons when confirmation matches active session', () => {
    mockPendingConfirmations = { 'session-1': makeConfirmation() };

    render(<LiveToolCallBubble activity={makeActivity()} />);

    expect(screen.getByTestId('confirmation-confirm-btn')).toBeDefined();
    expect(screen.getByTestId('confirmation-cancel-btn')).toBeDefined();
  });

  it('renders AlertTriangle icon with awaiting confirmation badge', () => {
    mockPendingConfirmations = { 'session-1': makeConfirmation() };

    render(<LiveToolCallBubble activity={makeActivity()} />);

    expect(screen.getByTestId('awaiting-confirmation-icon')).toBeDefined();
    expect(screen.getByText('awaiting confirmation')).toBeDefined();
  });

  it('does NOT render action buttons when no matching confirmation in store (other session)', () => {
    mockPendingConfirmations = {}; // nothing pending for current session

    render(<LiveToolCallBubble activity={makeActivity()} />);

    expect(screen.queryByTestId('confirmation-actions')).toBeNull();
  });

  it('does NOT render action buttons when confirmation is for a different callId', () => {
    mockPendingConfirmations = { 'session-1': makeConfirmation('session-1', 'call-OTHER') };

    render(<LiveToolCallBubble activity={makeActivity({ callId: 'call-1' })} />);

    expect(screen.queryByTestId('confirmation-actions')).toBeNull();
  });

  it('args are collapsed by default — shows truncated preview, not full list', () => {
    mockPendingConfirmations = { 'session-1': makeConfirmation() };

    render(<LiveToolCallBubble activity={makeActivity()} />);

    expect(screen.getByTestId('args-preview')).toBeDefined();
    expect(screen.queryByTestId('args-expanded')).toBeNull();
  });

  it('clicking expand toggle shows scrollable args container', () => {
    mockPendingConfirmations = { 'session-1': makeConfirmation() };

    render(<LiveToolCallBubble activity={makeActivity()} />);

    const toggle = screen.getByTestId('confirmation-args-toggle');
    act(() => { fireEvent.click(toggle); });

    expect(screen.getByTestId('args-expanded')).toBeDefined();
    expect(screen.queryByTestId('args-preview')).toBeNull();
  });

  it('Confirm button calls eventBus.confirmTool and clears confirmation from store', () => {
    mockPendingConfirmations = { 'session-1': makeConfirmation() };

    render(<LiveToolCallBubble activity={makeActivity()} />);

    act(() => { fireEvent.click(screen.getByTestId('confirmation-confirm-btn')); });

    expect(mockConfirmTool).toHaveBeenCalledWith({ requestId: 'req-1', sessionId: 'session-1' });
    expect(mockSetPendingConfirmation).toHaveBeenCalledWith('session-1', null);
    expect(mockUpdateToolActivity).toHaveBeenCalledWith('call-1', expect.objectContaining({ status: 'running' }));
  });

  it('Cancel button calls eventBus.cancelTool and clears confirmation from store', () => {
    mockPendingConfirmations = { 'session-1': makeConfirmation() };

    render(<LiveToolCallBubble activity={makeActivity()} />);

    act(() => { fireEvent.click(screen.getByTestId('confirmation-cancel-btn')); });

    expect(mockCancelTool).toHaveBeenCalledWith({ requestId: 'req-1', sessionId: 'session-1' });
    expect(mockSetPendingConfirmation).toHaveBeenCalledWith('session-1', null);
    expect(mockUpdateToolActivity).toHaveBeenCalledWith('call-1', expect.objectContaining({ status: 'cancelled' }));
  });

  it('activity with no args renders no preview and no toggle', () => {
    mockPendingConfirmations = { 'session-1': makeConfirmation() };

    render(<LiveToolCallBubble activity={makeActivity({ args: {} })} />);

    expect(screen.queryByTestId('args-preview')).toBeNull();
    expect(screen.queryByTestId('confirmation-args-toggle')).toBeNull();
  });
});

describe('HistoryToolCallBubble — run_subagent', () => {
  it('shows child session, VFS mode, copied count, and copied file path after expanding', () => {
    const content = JSON.stringify({
      result: 'created index.html',
      taskId: 'task-1',
      childSessionId: 'sub-child-1',
      parentSessionId: 'session-1',
      vfsMode: 'isolated',
      vfsSessionId: 'sub-child-1',
      copiedFiles: [{ fromPath: 'index.html', toPath: 'sub-agents/sub-child-1/index.html', sizeBytes: 42 }],
      durationMs: 12,
    });

    render(<HistoryToolCallBubble toolName="run_subagent" content={content} args={{ vfsMode: 'isolated' }} />);

    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Toggle details' })); });

    expect(screen.getByText('session')).toBeDefined();
    expect(screen.getByText('sub-child-1')).toBeDefined();
    expect(screen.getByText('vfs')).toBeDefined();
    expect(screen.getAllByText('isolated').length).toBeGreaterThan(0);
    expect(screen.getByText('copied')).toBeDefined();
    expect(screen.getByText('1')).toBeDefined();
    expect(screen.getByText('sub-agents/sub-child-1/index.html')).toBeDefined();
  });
});
