import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToolConfirmationRequest } from '@kalio/types';
import { useAgentStore, type ToolActivity } from '../../../store/agentStore';
import { useSessionStore } from '../../../store/sessionStore';
import { eventBus } from '../../../services/eventBus';
import { GraphInspectorActions } from './GraphInspectorActions';
import type { ExecutionGraphNode } from './executionGraphModel';

vi.mock('../../../services/eventBus', () => ({
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
const node: ExecutionGraphNode = {
  id: 'tool-node', kind: 'tool', title: request.toolName, subtitle: 'Pending', status: 'waiting',
  column: 0, row: 0, x: 0, y: 0, width: 220, height: 120, sessionId: 'child-session',
  payload: { kind: 'tool', toolName: request.toolName, args: request.args, activity, result: null, confirmationRequired: true },
};
function Harness() {
  const selected = useAgentStore(s => s.pendingConfirmations['child-session']?.[0] ?? null);
  return <GraphInspectorActions node={node} activeSessionId="parent-session" selectedConfirmation={selected}
    setActiveSession={useSessionStore.getState().setActiveSession} setPendingMessage={useSessionStore.getState().setPendingMessage}
    removePendingConfirmation={useAgentStore.getState().removePendingConfirmation} />;
}

describe('graph approval preservation with the real runtime store', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSessionStore.setState({ sessions: [], sessionMessages: {}, activeSessionId: 'parent-session' });
    useAgentStore.setState({
      pendingConfirmations: { 'child-session': [request] }, settledConfirmationRequestIds: {},
      toolActivities: [activity], sessionToolActivities: { 'child-session': [activity] }, runtimeActivitySnapshots: {},
    });
  });

  it.each(['pointer', 'keyboard'])('keeps an unanswered cross-session %s approval pending', async (input) => {
    const user = userEvent.setup();
    render(<Harness />);
    const approve = screen.getByRole('button', { name: 'Accept tool request' });
    if (input === 'keyboard') {
      approve.focus();
      await user.keyboard('{Enter}');
    } else await user.click(approve);

    expect(eventBus.confirmTool).toHaveBeenCalledWith({ requestId: 'request-child', sessionId: 'child-session' });
    expect(useAgentStore.getState().pendingConfirmations['child-session']).toEqual([request]);
    expect(useAgentStore.getState().settledConfirmationRequestIds['request-child']).toBeUndefined();
    expect(useAgentStore.getState().getToolActivitiesForSession('child-session')[0].status).toBe('awaiting_confirmation');
    expect(screen.getByRole('button', { name: 'Accept tool request' })).toBeVisible();
  });

  it('removes approval actions when the authoritative pending projection is cleared', () => {
    render(<Harness />);
    act(() => useAgentStore.getState().removePendingConfirmation('child-session', 'request-child'));
    expect(screen.queryByRole('button', { name: 'Accept tool request' })).toBeNull();
  });

  it('preserves existing optimistic cancellation', async () => {
    render(<Harness />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Cancel tool request' }));
    expect(eventBus.cancelTool).toHaveBeenCalledWith({ requestId: 'request-child', sessionId: 'child-session' });
    expect(useAgentStore.getState().pendingConfirmations['child-session'] ?? []).toEqual([]);
    expect(screen.queryByRole('button', { name: 'Accept tool request' })).toBeNull();
  });
});
