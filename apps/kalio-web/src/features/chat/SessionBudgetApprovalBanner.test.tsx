import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { SessionBudgetApprovalBanner } from './SessionBudgetApprovalBanner';
import { useAgentStore } from '../../store/agentStore';
import { eventBus } from '../../services/eventBus';

vi.mock('../../services/eventBus', () => ({
  eventBus: {
    approveAgentBudget: vi.fn(),
  },
}));

describe('SessionBudgetApprovalBanner', () => {
  beforeEach(() => {
    vi.mocked(eventBus.approveAgentBudget).mockReset();
    useAgentStore.setState({
      pendingBudgetApprovals: {},
    });
  });

  it('renders session-level budget HITL and sends typed approval decisions', () => {
    useAgentStore.getState().setPendingBudgetApproval('session-1', {
      requestId: 'budget-1',
      sessionId: 'session-1',
      scope: 'agent-flow-branch',
      usedIterations: 1,
      currentLimit: 1,
      suggestedNextLimit: 11,
    });

    render(<SessionBudgetApprovalBanner sessionId="session-1" />);

    expect(screen.getByTestId('turn-budget-approval')).toHaveTextContent('Agent reached tool loop limit 1/1');
    fireEvent.click(screen.getByRole('button', { name: '+10' }));
    expect(eventBus.approveAgentBudget).toHaveBeenCalledWith({
      requestId: 'budget-1',
      sessionId: 'session-1',
      decision: 'allow_ten',
    });
    expect(screen.queryByTestId('turn-budget-approval')).not.toBeInTheDocument();
  });

  it('treats missing pending budget approval state as no active approvals', () => {
    useAgentStore.setState({
      pendingBudgetApprovals: undefined as never,
    });

    render(<SessionBudgetApprovalBanner sessionId="session-1" />);

    expect(screen.queryByTestId('turn-budget-approval')).not.toBeInTheDocument();
  });
});
