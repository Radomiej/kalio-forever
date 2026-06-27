import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentFlowResumeAction } from './AgentFlowResumeAction';

const { resumeAgentFlowRun } = vi.hoisted(() => ({
  resumeAgentFlowRun: vi.fn(),
}));

vi.mock('./agentFlow.api', () => ({
  resumeAgentFlowRun,
}));

describe('AgentFlowResumeAction', () => {
  beforeEach(() => {
    resumeAgentFlowRun.mockReset();
  });

  it('shows retry guidance and re-enables the button after a failed resume request', async () => {
    resumeAgentFlowRun.mockRejectedValueOnce(new Error('network down'));

    render(<AgentFlowResumeAction flowRunId="flow-run-1" />);

    const button = screen.getByTestId('resume-agentflow-flow-run-1');
    fireEvent.click(button);

    await waitFor(() => {
      expect(resumeAgentFlowRun).toHaveBeenCalledWith('flow-run-1', { input: 'Continue.' });
      expect(screen.getByText('Resume request failed. Reconnect and retry.')).toBeInTheDocument();
      expect(button).not.toBeDisabled();
    });
  });
});
