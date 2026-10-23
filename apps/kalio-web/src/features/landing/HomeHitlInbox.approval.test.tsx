import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToolConfirmationRequest } from '@kalio/types';
import { useAgentStore, type ToolActivity } from '../../store/agentStore';
import { useSessionStore } from '../../store/sessionStore';
import { eventBus } from '../../services/eventBus';
import { HomeHitlInbox } from './HomeHitlInbox';

vi.mock('../../services/eventBus', () => ({
  eventBus: { confirmTool: vi.fn(), cancelTool: vi.fn() },
}));

const request: ToolConfirmationRequest = {
  requestId: 'request-child', toolCallId: 'call-child', sessionId: 'child-session',
  toolName: 'run_sub_agentflow', args: { goal: 'Implement the approved change' }, timeoutMs: 0,
};
const activity: ToolActivity = {
  callId: 'call-child', requestId: 'request-child', sessionId: 'child-session',
  toolName: request.toolName, args: request.args, status: 'awaiting_confirmation', startedAt: 1,
};

describe('Home approval preservation with the real runtime store', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSessionStore.setState({ sessions: [], activeSessionId: 'parent-session' });
    useAgentStore.setState({
      pendingConfirmations: { 'child-session': [request] }, pendingBudgetApprovals: {},
      settledConfirmationRequestIds: {}, toolActivities: [activity],
      sessionToolActivities: { 'child-session': [activity] }, runtimeActivitySnapshots: {},
    });
  });

  it.each(['pointer', 'keyboard'])('keeps an unanswered cross-session %s approval and note visible', async (input) => {
    const user = userEvent.setup();
    render(<HomeHitlInbox onOpenSession={vi.fn()} />);
    await user.type(screen.getByTestId('home-hitl-note-request-child'), '  Approved scope only.  ');
    const approve = screen.getByRole('button', { name: 'Approve' });
    if (input === 'keyboard') {
      approve.focus();
      await user.keyboard('{Enter}');
    } else await user.click(approve);

    expect(eventBus.confirmTool).toHaveBeenCalledWith({
      requestId: 'request-child', sessionId: 'child-session', message: 'Approved scope only.',
    });
    expect(useAgentStore.getState().pendingConfirmations['child-session']).toEqual([request]);
    expect(useAgentStore.getState().settledConfirmationRequestIds['request-child']).toBeUndefined();
    expect(useAgentStore.getState().getToolActivitiesForSession('child-session')[0].status).toBe('awaiting_confirmation');
    expect(screen.getByRole('button', { name: 'Approve' })).toBeVisible();
    expect(screen.getByTestId('home-hitl-note-request-child')).toHaveValue('  Approved scope only.  ');
  });

  it('removes the request when the authoritative pending projection is cleared', () => {
    render(<HomeHitlInbox onOpenSession={vi.fn()} />);
    act(() => useAgentStore.getState().removePendingConfirmation('child-session', 'request-child'));
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
    expect(screen.getByText('Nothing to do.')).toBeVisible();
  });

  it('preserves existing optimistic rejection', async () => {
    render(<HomeHitlInbox onOpenSession={vi.fn()} />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Reject' }));
    expect(eventBus.cancelTool).toHaveBeenCalledWith({ requestId: 'request-child', sessionId: 'child-session' });
    expect(useAgentStore.getState().pendingConfirmations['child-session'] ?? []).toEqual([]);
    expect(useAgentStore.getState().getToolActivitiesForSession('child-session')[0].status).toBe('cancelled');
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
  });
});
