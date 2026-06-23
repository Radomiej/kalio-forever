import type { AgentFlowRunSnapshot } from '@kalio/types';
import type { AgentFlowRuntimePort } from '../agent-flow/agent-flow-runtime.port';

export async function findAgentFlowSnapshotsForSessions(
  agentFlowRuntime: Pick<AgentFlowRuntimePort, 'findAll' | 'findByParentSessionId'>,
  sessionIds: string[],
): Promise<AgentFlowRunSnapshot[]> {
  if (agentFlowRuntime.findByParentSessionId) {
    const snapshots = await Promise.all(
      sessionIds.map((sessionId) => agentFlowRuntime.findByParentSessionId?.(sessionId) ?? Promise.resolve([])),
    );
    return snapshots.flat();
  }
  return agentFlowRuntime.findAll?.() ?? [];
}

export function isActiveAgentFlowSnapshot(snapshot: AgentFlowRunSnapshot): boolean {
  return snapshot.run.status === 'running'
    || snapshot.run.status === 'queued'
    || snapshot.run.status === 'waiting_on_orchestrator';
}
