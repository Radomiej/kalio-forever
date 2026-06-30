import type { AgentFlowLifecycleEvent, AgentFlowRunStatus, AgentFlowTraceItem, SubAgentFlowResult } from '@kalio/types';

const AGENT_FLOW_STATUSES: AgentFlowRunStatus[] = [
  'queued',
  'running',
  'waiting_on_orchestrator',
  'done',
  'failed',
  'cancelled',
  'blocked',
];
const AGENT_FLOW_LIFECYCLES: AgentFlowLifecycleEvent[] = [
  'started',
  'node_started',
  'node_completed',
  'edge_taken',
  'guard_result',
  'tool_called',
  'return_to_orchestrator',
  'waiting_on_orchestrator',
  'resume_input',
  'done',
  'blocked',
  'failed',
  'cancelled',
  'runtime_missing',
  'runtime_stalled',
  'copy_back',
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isAgentFlowStatus(value: unknown): value is AgentFlowRunStatus {
  return typeof value === 'string' && AGENT_FLOW_STATUSES.includes(value as AgentFlowRunStatus);
}

function isAgentFlowLifecycle(value: unknown): value is AgentFlowLifecycleEvent {
  return typeof value === 'string' && AGENT_FLOW_LIFECYCLES.includes(value as AgentFlowLifecycleEvent);
}

function traceItem(value: unknown): AgentFlowTraceItem | null {
  if (!isRecord(value)) return null;
  if (
    typeof value['id'] !== 'string' ||
    typeof value['sequence'] !== 'number' ||
    typeof value['type'] !== 'string' ||
    typeof value['message'] !== 'string' ||
    typeof value['createdAt'] !== 'number'
  ) {
    return null;
  }
  if (value['nodeId'] !== undefined && typeof value['nodeId'] !== 'string') return null;
  if (value['roleSlotId'] !== undefined && typeof value['roleSlotId'] !== 'string') return null;
  if (value['status'] !== undefined && !isAgentFlowStatus(value['status'])) return null;
  if (value['lifecycle'] !== undefined && !isAgentFlowLifecycle(value['lifecycle'])) return null;

  return {
    id: value['id'],
    sequence: value['sequence'],
    type: value['type'],
    lifecycle: isAgentFlowLifecycle(value['lifecycle']) ? value['lifecycle'] : undefined,
    message: value['message'],
    nodeId: typeof value['nodeId'] === 'string' ? value['nodeId'] : undefined,
    roleSlotId: typeof value['roleSlotId'] === 'string' ? value['roleSlotId'] : undefined,
    status: isAgentFlowStatus(value['status']) ? value['status'] : undefined,
    createdAt: value['createdAt'],
  };
}

function tracePreview(value: unknown): AgentFlowTraceItem[] | undefined | null {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return null;
  const parsed = value.map(traceItem);
  return parsed.every((item): item is AgentFlowTraceItem => item !== null) ? parsed : null;
}

export function extractSubAgentFlowResult(data: unknown): SubAgentFlowResult | null {
  if (!isRecord(data)) return null;
  const status = data['status'];
  const parsedTrace = tracePreview(data['tracePreview']);
  if (
    typeof data['flowRunId'] !== 'string' ||
    typeof data['childSessionId'] !== 'string' ||
    !isAgentFlowStatus(status) ||
    typeof data['summary'] !== 'string' ||
    !isStringArray(data['decisions']) ||
    !isStringArray(data['nextActions']) ||
    !isStringArray(data['artifacts']) ||
    parsedTrace === null
  ) {
    return null;
  }

  return {
    flowRunId: data['flowRunId'],
    flowDefinitionId: typeof data['flowDefinitionId'] === 'string' ? data['flowDefinitionId'] : undefined,
    parentSessionId: typeof data['parentSessionId'] === 'string' ? data['parentSessionId'] : undefined,
    parentToolCallId: typeof data['parentToolCallId'] === 'string' ? data['parentToolCallId'] : undefined,
    childSessionId: data['childSessionId'],
    status,
    summary: data['summary'],
    decisions: data['decisions'],
    nextActions: data['nextActions'],
    artifacts: data['artifacts'],
    returnToOrchestratorCount: typeof data['returnToOrchestratorCount'] === 'number'
      ? data['returnToOrchestratorCount']
      : undefined,
    tracePreview: parsedTrace,
    openChatSessionId: typeof data['openChatSessionId'] === 'string' ? data['openChatSessionId'] : undefined,
    openGraphRunId: typeof data['openGraphRunId'] === 'string' ? data['openGraphRunId'] : undefined,
  };
}
