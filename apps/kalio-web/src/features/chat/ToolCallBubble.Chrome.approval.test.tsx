import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToolConfirmationRequest } from '@kalio/types';
import { useAgentStore, type ToolActivity } from '../../store/agentStore';
import { eventBus } from '../../services/eventBus';
import { ConfirmationInlineBubble } from './ToolCallBubble.Chrome';

vi.mock('../../services/eventBus', () => ({
  eventBus: { confirmTool: vi.fn(), cancelTool: vi.fn() },
}));

const request: ToolConfirmationRequest = {
  requestId: 'request-child', toolCallId: 'call-child', sessionId: 'child-session',
  toolName: 'run_sub_agentflow', args: { goal: 'Implement the approved change' }, timeoutMs: 0,
};
const activity: ToolActivity = {
  callId: 'call-child', requestId: 'request-child', sessionId: 'child-session',
  toolName: 'run_sub_agentflow', args: request.args, status: 'awaiting_confirmation', startedAt: 1,
};

describe('inline approval preservation with the real runtime store', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAgentStore.setState({
      pendingConfirmations: { 'child-session': [request] }, settledConfirmationRequestIds: {},
      toolActivities: [activity], sessionToolActivities: { 'child-session': [activity] },
      toolArgProgress: null, runtimeActivitySnapshots: {},
    });
  });

  it.each(['pointer', 'keyboard'])('keeps an unanswered %s approval visible and awaiting confirmation', async (input) => {
    const user = userEvent.setup();
    const view = render(<ConfirmationInlineBubble activity={activity} />);
    const approve = screen.getByRole('button', { name: 'Confirm' });
    if (input === 'keyboard') {
      approve.focus();
      await user.keyboard('{Enter}');
    } else await user.click(approve);

    expect(eventBus.confirmTool).toHaveBeenCalledWith({ requestId: 'request-child', sessionId: 'child-session' });
    expect(useAgentStore.getState().pendingConfirmations['child-session']).toEqual([request]);
    expect(useAgentStore.getState().settledConfirmationRequestIds['request-child']).toBeUndefined();
    expect(useAgentStore.getState().getToolActivitiesForSession('child-session')[0].status).toBe('awaiting_confirmation');
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeVisible();
    expect(screen.getByText('awaiting confirmation')).toBeVisible();

    // No reply (including the gateway's silent rejection) must not poison replay/remount.
    view.unmount();
    render(<ConfirmationInlineBubble activity={activity} />);
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeVisible();
  });

  it('removes actions when the authoritative pending projection is cleared', () => {
    render(<ConfirmationInlineBubble activity={activity} />);
    act(() => useAgentStore.getState().removePendingConfirmation('child-session', 'request-child'));
    expect(screen.queryByRole('button', { name: 'Confirm' })).toBeNull();
  });

  it('preserves existing optimistic cancellation', async () => {
    render(<ConfirmationInlineBubble activity={activity} />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Cancel' }));
    expect(eventBus.cancelTool).toHaveBeenCalledWith({ requestId: 'request-child', sessionId: 'child-session' });
    expect(useAgentStore.getState().pendingConfirmations['child-session'] ?? []).toEqual([]);
    expect(useAgentStore.getState().getToolActivitiesForSession('child-session')[0].status).toBe('cancelled');
    expect(screen.queryByRole('button', { name: 'Confirm' })).toBeNull();
  });
});
