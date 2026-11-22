import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToolConfirmationRequest } from '@kalio/types';
import { useAgentStore } from '../../store/agentStore';
import { useSessionStore } from '../../store/sessionStore';
import { eventBus } from '../../services/eventBus';
import { HomeHitlInbox } from './HomeHitlInbox';

vi.mock('../../services/eventBus', () => ({
  eventBus: { identifySession: vi.fn(), confirmTool: vi.fn(), cancelTool: vi.fn() },
}));

const cwd = 'C:\\Users\\Radomiej\\Projects\\Very long project folder\\nested\\approved worktree';
const argv = ['--files', ...Array.from({ length: 24 }, (_, i) => `${cwd}\\file ${i}.tsx`), '--hidden'];
const request: ToolConfirmationRequest = {
  requestId: 'terminal-request', sessionId: 'terminal-session', toolCallId: 'terminal-call',
  toolName: 'terminal_spawn', args: { command: 'rg', args: argv, cwd }, timeoutMs: 0,
};

describe('Home approval visibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    });
    HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    });
    useSessionStore.setState({ sessions: [{
      id: request.sessionId, personaId: 'persona-recorded', title: 'Recorded waiting session', createdAt: 1, updatedAt: 1,
    }] });
    useAgentStore.setState({
      pendingConfirmations: { [request.sessionId]: [request] }, pendingBudgetApprovals: {},
      sessionToolActivities: {}, toolActivities: [], settledConfirmationRequestIds: {},
    });
  });

  it('uses one container-independent column and includes command, all argv and cwd in the summary', () => {
    render(<div style={{ width: 280 }}><HomeHitlInbox onOpenSession={vi.fn()} /></div>);
    const card = screen.getByRole('button', { name: 'Approve' }).closest('article')!;
    expect(card.parentElement).toHaveClass('grid-cols-1');
    expect(card.parentElement?.className).not.toMatch(/(?:sm|md|lg|xl):grid-cols-/);
    expect(within(card).getByText(/Waiting for approval/)).toHaveTextContent('Recorded waiting session');
    const summary = screen.getByTestId('home-hitl-summary-terminal-request');
    expect(summary).toHaveTextContent('command: rg');
    expect(summary).toHaveTextContent('--hidden');
    expect(summary).toHaveTextContent(`cwd: ${cwd}`);
  });

  it('shows recorded agent label instead of inventing a persona name', () => {
    useAgentStore.setState({ pendingConfirmations: { [request.sessionId]: [{
      ...request, agentRun: { agentRunId: 'run-1', agentType: 'subagent', label: 'Recorded worker' },
    }] } });
    render(<HomeHitlInbox onOpenSession={vi.fn()} />);
    expect(screen.getByText(/Waiting for approval/)).toHaveTextContent('Recorded waiting session');
    expect(screen.getByText('Recorded worker')).toBeVisible();
  });

  it('opens full details by keyboard, preserves full Windows arguments, closes via cancel and returns focus', async () => {
    const user = userEvent.setup();
    render(<HomeHitlInbox onOpenSession={vi.fn()} />);
    const details = screen.getByRole('button', { name: 'Details' });
    await user.tab();
    expect(details).toHaveFocus();
    await user.keyboard('{Enter}');
    const dialog = screen.getByRole('dialog', { name: 'Approval details' });
    expect(within(dialog).getByText('rg', { exact: true })).toBeVisible();
    expect(within(dialog).getByText(cwd, { exact: true })).toBeVisible();
    expect(JSON.parse(within(dialog).getByTestId('home-hitl-detail-args').textContent!)).toEqual(argv);
    expect(within(dialog).getByTestId('home-hitl-detail-args')).toHaveClass('whitespace-pre-wrap', 'break-words');
    expect(within(dialog).getByRole('button', { name: 'Close approval details' })).toHaveFocus();
    // jsdom does not implement native Escape-to-dialog-cancel dispatch.
    fireEvent(dialog, new Event('cancel', { cancelable: true }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(details).toHaveFocus();
    expect(eventBus.confirmTool).not.toHaveBeenCalled();
    expect(eventBus.cancelTool).not.toHaveBeenCalled();
  });

  it('drops open details when authoritative pending state invalidates the request', async () => {
    render(<HomeHitlInbox onOpenSession={vi.fn()} />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Details' }));
    act(() => useAgentStore.getState().removePendingConfirmation(request.sessionId, request.requestId));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
  });

  it('highlights the session role when the run label is generic and shows the existing policy reason', async () => {
    const reason = 'Jev p(allow)=0.94; threshold=0.95.';
    const durableRequest = { ...request, policyReason: reason,
      agentRun: { agentRunId: 'run-1', agentType: 'subagent' as const, label: 'Sub-agent' } };
    useAgentStore.setState({ pendingConfirmations: { [request.sessionId]: [durableRequest] } });
    useSessionStore.setState({ sessions: [{ id: request.sessionId, personaId: 'recorded-persona',
      title: 'Game Development2:Core Loop Developer', createdAt: 1, updatedAt: 1 }] });
    render(<HomeHitlInbox onOpenSession={vi.fn()} />);
    expect(screen.getByText(/Waiting for approval/)).toHaveTextContent('Game Development2:Core Loop Developer');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Details' }));
    expect(within(screen.getByRole('dialog')).getByText(reason)).toBeVisible();
    expect(eventBus.confirmTool).not.toHaveBeenCalled();
  });

  it('falls back to recorded request label, then session ID without a session record', () => {
    useSessionStore.setState({ sessions: [] });
    const { rerender } = render(<HomeHitlInbox onOpenSession={vi.fn()} />);
    expect(screen.getByText(/Waiting for approval/)).toHaveTextContent('Session terminal');
    act(() => useAgentStore.setState({ pendingConfirmations: { [request.sessionId]: [{ ...request,
      agentRun: { agentRunId: 'run-1', agentType: 'subagent', label: 'Recorded worker' },
    }] } }));
    rerender(<HomeHitlInbox onOpenSession={vi.fn()} />);
    expect(screen.getByText(/Waiting for approval/)).toHaveTextContent('Recorded worker');
  });

  it.each(['Approve', 'Reject'])('preserves notes, exact IDs and %s semantics after inspecting details', async (decision) => {
    const user = userEvent.setup();
    const openSession = vi.fn();
    render(<HomeHitlInbox onOpenSession={openSession} />);
    await user.type(screen.getByTestId('home-hitl-note-terminal-request'), '  exact approved scope  ');
    await user.click(screen.getByRole('button', { name: 'Details' }));
    await user.click(screen.getByRole('button', { name: 'Close approval details' }));
    await user.click(screen.getByRole('button', { name: 'Open' }));
    expect(openSession).toHaveBeenCalledExactlyOnceWith(request.sessionId);
    await user.click(screen.getByRole('button', { name: decision }));
    const event = decision === 'Approve' ? eventBus.confirmTool : eventBus.cancelTool;
    expect(event).toHaveBeenCalledExactlyOnceWith({
      requestId: request.requestId, sessionId: request.sessionId, message: 'exact approved scope',
    });
    expect(vi.mocked(eventBus.identifySession).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(event).mock.invocationCallOrder[0]);
    expect(useAgentStore.getState().pendingConfirmations[request.sessionId] ?? [])
      .toEqual(decision === 'Approve' ? [request] : []);
  });
});
