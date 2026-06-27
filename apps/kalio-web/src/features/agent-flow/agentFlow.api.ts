import type { AgentFlowRunSnapshot } from '@kalio/types';
import { apiClient } from '../../services/apiClient';

export interface ResumeAgentFlowRunDto {
  input?: string;
  context?: Record<string, unknown>;
  maxSteps?: number;
}

export async function resumeAgentFlowRun(
  runId: string,
  dto: ResumeAgentFlowRunDto = {},
): Promise<AgentFlowRunSnapshot> {
  const { data } = await apiClient.post<AgentFlowRunSnapshot>(`/api/agent-flows/runs/${runId}/resume`, dto);
  return data;
}
