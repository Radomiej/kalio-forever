import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resumeAgentFlowRun } from './agentFlow.api';

const { apiPost } = vi.hoisted(() => ({
  apiPost: vi.fn(),
}));

vi.mock('../../services/apiClient', () => ({
  apiClient: {
    post: apiPost,
  },
}));

describe('agentFlow.api', () => {
  beforeEach(() => {
    apiPost.mockReset();
  });

  it('posts generic resume input to the durable AgentFlow run endpoint', async () => {
    apiPost.mockResolvedValueOnce({
      data: {
        run: {
          id: 'flow-run-1',
          parentSessionId: 'session-1',
          childSessionId: 'flow-child-1',
          flowDefinitionId: 'goal_guard_delivery_loop',
          status: 'running',
          startMode: 'durable',
          returnMode: 'summary',
          createdAt: 1,
          updatedAt: 2,
        },
        events: [],
      },
    });

    const result = await resumeAgentFlowRun('flow-run-1', { input: 'Continue.' });

    expect(apiPost).toHaveBeenCalledWith('/api/agent-flows/runs/flow-run-1/resume', { input: 'Continue.' });
    expect(result.run.id).toBe('flow-run-1');
  });
});
