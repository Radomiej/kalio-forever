import type { AgentFlowRunSnapshot } from '@kalio/types';
import type { AgentFlowRuntimePort } from '../agent-flow/agent-flow-runtime.port';

export async function findAgentFlowSnapshotsForSessions(
  agentFlowRuntime: Pick<AgentFlowRuntimePort, 'findAll' | 'findByParentSessionId'>,
  sessionIds: string[],
): Promise<AgentFlowRunSnapshot[]> {
  if (agentFlowRuntime.findAll) {
    return agentFlowRuntime.findAll();
  }
  if (!agentFlowRuntime.findByParentSessionId) {
    return [];
  }
  const snapshots = await Promise.all(
    sessionIds.map((sessionId) => agentFlowRuntime.findByParentSessionId?.(sessionId) ?? Promise.resolve([])),
  );
  return snapshots.flat();
}

export function isActiveAgentFlowSnapshot(snapshot: AgentFlowRunSnapshot): boolean {
  return snapshot.run.status === 'running'
    || snapshot.run.status === 'queued'
    || snapshot.run.status === 'waiting_on_orchestrator';
}
