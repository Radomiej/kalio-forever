import { apiClient } from '../../services/apiClient';
import type {
  AgentFlowTraceItem,
  ArchitectureRun,
  ArchitectureExecutionEvent,
  ArchitectureExecutionMode,
  AgentFlowRunSnapshot,
  ChatSession,
  CreateArchitectureRunDto,
  CreateArchitectureSchemaVariantDto,
} from '@kalio/types';
import type {
  ArchitectPersona,
  ExternalQualityGateInput,
  ArchitectRunResult,
  ArchitectSchema,
  PersonaOverrideMap,
} from './architect.types';
import type { LLMConfigWithSource } from '../settings/llm-panel.types';
import { normalizeArchitectureSchemas } from './architect.schema';
import { resumeAgentFlowRun as resumeAgentFlowRunApi } from '../agent-flow/agentFlow.api';

export { resumeAgentFlowRun } from '../agent-flow/agentFlow.api';

export async function getArchitectureSchemas(): Promise<ArchitectSchema[]> {
  const { data } = await apiClient.get<unknown>('/api/architecture-registry/schemas');
  return normalizeArchitectureSchemas(data);
}

export async function getArchitectPersonas(): Promise<ArchitectPersona[]> {
  const { data } = await apiClient.get<ArchitectPersona[]>('/api/personas');
  return data;
}

export async function getArchitectRuntimeConfig(): Promise<LLMConfigWithSource> {
  const { data } = await apiClient.get<LLMConfigWithSource>('/api/llm/config');
  return data;
}

export async function getArchitectActiveCredentialId(): Promise<string | null> {
  const { data } = await apiClient.get<{ credentialId: string | null }>('/api/credentials/active');
  return data.credentialId;
}

export async function saveArchitectureVariant(
  schemaId: string,
  dto: CreateArchitectureSchemaVariantDto,
): Promise<ArchitectSchema> {
  const { data } = await apiClient.post<unknown>(`/api/architecture-registry/schemas/${schemaId}/variants`, dto);
  if (!data) {
    throw new Error('Architecture variant response was empty');
  }
  const variant = normalizeArchitectureSchemas([data])[0];
  return variant;
}

export async function deleteArchitectureSchema(schemaId: string): Promise<void> {
  await apiClient.delete(`/api/architecture-registry/schemas/${schemaId}`);
}

export async function startArchitectureRun(
  schemaId: string,
  prompt: string,
  personaOverrides: PersonaOverrideMap,
  executionMode: ArchitectureExecutionMode,
  schema?: ArchitectSchema,
  context?: Record<string, unknown>,
  onUpdate?: (result: ArchitectRunResult) => void,
): Promise<ArchitectRunResult> {
  const dto: CreateArchitectureRunDto = {
    schemaId,
    prompt,
    slotOverrides: personaOverrides,
    executionMode,
    context,
  };
  if (schema) {
    dto.schema = {
      ...schema,
      nodes: schema.nodes.map((node) => ({
        id: node.id,
        label: node.label,
        kind: node.kind,
        roleSlotId: node.roleSlotId,
        maxToolAttempts: node.maxToolAttempts,
        toolOverride: node.toolOverride ? { ...node.toolOverride } : undefined,
        behavior: node.behavior ? { ...node.behavior } : undefined,
        x: node.x,
        y: node.y,
      })),
      edges: schema.edges.map((edge) => ({ ...edge })),
    };
  }
  const { data: run } = await apiClient.post<ArchitectRunResult['run']>('/api/architecture-runs/async', dto);
  return pollArchitectureRunResult(run, onUpdate);
}

export async function stopArchitectureRun(runId: string): Promise<ArchitectureRun> {
  const { data } = await apiClient.post<ArchitectureRun>(`/api/architecture-runs/${runId}/stop`);
  return data;
}

export async function stopGoalGuardAgentFlowRun(runId: string): Promise<AgentFlowRunSnapshot> {
  const { data } = await apiClient.post<AgentFlowRunSnapshot>(`/api/agent-flows/runs/${runId}/stop`);
  return data;
}

const AGENT_FLOW_POLL_INTERVAL_MS = 1000;
const AGENT_FLOW_POLL_MAX_ATTEMPTS = 180;

type AgentFlowRunPollUpdate = (snapshot: AgentFlowRunSnapshot) => void | Promise<void>;

interface AgentFlowRunPollOptions {
  intervalMs?: number;
  maxAttempts?: number;
  shouldContinue?: () => boolean;
}

function isStableAgentFlowRunStatus(status: AgentFlowRunSnapshot['run']['status']): boolean {
  return status === 'done'
    || status === 'failed'
    || status === 'blocked'
    || status === 'cancelled'
    || status === 'waiting_on_orchestrator';
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getAgentFlowRunSnapshot(runId: string): Promise<AgentFlowRunSnapshot> {
  const { data } = await apiClient.get<AgentFlowRunSnapshot>(`/api/agent-flows/runs/${runId}`);
  return data;
}

async function pollAgentFlowSnapshotFrom(
  initialSnapshot: AgentFlowRunSnapshot,
  onUpdate?: AgentFlowRunPollUpdate,
  options: AgentFlowRunPollOptions = {},
): Promise<AgentFlowRunSnapshot> {
  const intervalMs = options.intervalMs ?? AGENT_FLOW_POLL_INTERVAL_MS;
  const maxAttempts = options.maxAttempts ?? AGENT_FLOW_POLL_MAX_ATTEMPTS;
  const shouldContinue = options.shouldContinue ?? (() => true);
  let snapshot = initialSnapshot;
  await onUpdate?.(snapshot);

  for (let attempt = 0; attempt < maxAttempts && !isStableAgentFlowRunStatus(snapshot.run.status); attempt += 1) {
    await wait(intervalMs);
    if (!shouldContinue()) {
      return snapshot;
    }
    snapshot = await getAgentFlowRunSnapshot(snapshot.run.id);
    await onUpdate?.(snapshot);
  }

  return snapshot;
}

export async function pollAgentFlowRunUntilStable(
  initialSnapshot: AgentFlowRunSnapshot,
  onUpdate?: AgentFlowRunPollUpdate,
  options?: AgentFlowRunPollOptions,
): Promise<AgentFlowRunSnapshot> {
  return pollAgentFlowSnapshotFrom(initialSnapshot, onUpdate, options);
}

export async function refreshAgentFlowRunUntilStable(
  runId: string,
  onUpdate?: AgentFlowRunPollUpdate,
  options?: AgentFlowRunPollOptions,
): Promise<AgentFlowRunSnapshot> {
  const snapshot = await getAgentFlowRunSnapshot(runId);
  return pollAgentFlowSnapshotFrom(snapshot, onUpdate, options);
}

async function pollArchitectureRunResult(
  initialRun: ArchitectureRun,
  onUpdate?: (result: ArchitectRunResult) => void,
): Promise<ArchitectRunResult> {
  let result = await getArchitectureRunResult(initialRun);
  onUpdate?.(result);

  while (result.run.status === 'queued' || result.run.status === 'running') {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const { data: run } = await apiClient.get<ArchitectureRun>(`/api/architecture-runs/${result.run.id}`);
    result = await getArchitectureRunResult(run);
    onUpdate?.(result);
  }

  return result;
}

function architectureStatusFromAgentFlow(status: AgentFlowRunSnapshot['run']['status']): ArchitectureRun['status'] {
  if (status === 'done') return 'completed';
  if (status === 'failed' || status === 'blocked' || status === 'cancelled') return 'failed';
  if (status === 'queued') return 'queued';
  return 'running';
}

export async function startGoalGuardAgentFlowRun(
  prompt: string,
  context?: Record<string, unknown>,
  parentSessionId = 'architect-ui',
  onUpdate?: (result: ArchitectRunResult) => void,
): Promise<ArchitectRunResult> {
  const { data: snapshot } = await apiClient.post<AgentFlowRunSnapshot>('/api/agent-flows/runs', {
    flowId: 'goal_guard_delivery_loop',
    goal: prompt,
    parentSessionId,
    startMode: 'durable',
    returnMode: 'summary',
    maxSteps: typeof context?.maxArchitectureSteps === 'number' ? context.maxArchitectureSteps : undefined,
    context,
  });
  if (!onUpdate) {
    return getGoalGuardAgentFlowRunResult(snapshot, prompt, context);
  }

  let latestResult: ArchitectRunResult | null = null;
  const finalSnapshot = await pollAgentFlowRunUntilStable(snapshot, async (nextSnapshot) => {
    latestResult = await getGoalGuardAgentFlowRunResult(nextSnapshot, prompt, context);
    onUpdate(latestResult);
  });
  return latestResult ?? getGoalGuardAgentFlowRunResult(finalSnapshot, prompt, context);
}

export async function getGoalGuardAgentFlowRunResult(
  snapshotOrRunId: AgentFlowRunSnapshot | string,
  prompt: string,
  context?: Record<string, unknown>,
): Promise<ArchitectRunResult> {
  const snapshot = typeof snapshotOrRunId === 'string'
    ? (await apiClient.get<AgentFlowRunSnapshot>(`/api/agent-flows/runs/${snapshotOrRunId}`)).data
    : snapshotOrRunId;
  const graphRunId = snapshot.run.openGraphRunId ?? snapshot.result?.openGraphRunId ?? snapshot.run.id;
  const rootSessionId = snapshot.run.openChatSessionId ?? snapshot.result?.openChatSessionId ?? snapshot.run.childSessionId;
  const run: ArchitectureRun = {
    id: graphRunId,
    schemaId: 'goal-master-delivery-loop',
    prompt,
    executionMode: 'session_branches',
    context,
    rootSessionId,
    status: architectureStatusFromAgentFlow(snapshot.run.status),
    createdAt: snapshot.run.createdAt,
    updatedAt: snapshot.run.updatedAt,
    ...(snapshot.run.finishedAt ? { completedAt: snapshot.run.finishedAt } : {}),
  };
  let result: ArchitectRunResult;
  try {
    result = await getArchitectureRunResult(run);
  } catch (err) {
    console.warn('Falling back to AgentFlow snapshot projection for Architect run result', err);
    result = agentFlowSnapshotToArchitectResult(snapshot, run);
  }
  return {
    ...result,
    run,
    agentFlowRunId: snapshot.run.id,
    agentFlowStatus: snapshot.run.status,
    agentFlowSummary: snapshot.result?.summary,
  };
}

function agentFlowSnapshotToArchitectResult(snapshot: AgentFlowRunSnapshot, run: ArchitectureRun): ArchitectRunResult {
  const events = (snapshot.events ?? []).map((event) => agentFlowTraceToArchitectureEvent(event, run.id));
  const nodeIds = Array.from(new Set(events.map((event) => event.nodeId).filter((id): id is string => Boolean(id))));
  return {
    run,
    events,
    graph: {
      runId: run.id,
      nodes: nodeIds.map((nodeId) => ({
        id: nodeId,
        label: nodeId.split('-').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' '),
        kind: nodeId === 'goal-master' || nodeId === 'orchestrator' ? 'router' : 'role',
        status: events.some((event) => event.nodeId === nodeId && event.type === 'node_completed')
          ? 'completed'
          : events.some((event) => event.nodeId === nodeId && (
            event.type === 'node_started'
            || event.type === 'agent_started'
            || event.type === 'tool_call'
            || event.type === 'human_gate'
          ))
            ? 'running'
            : 'pending',
        visitCount: Math.max(
          events.filter((event) => event.nodeId === nodeId && event.type === 'node_started').length,
          events.some((event) => event.nodeId === nodeId) ? 1 : 0,
        ),
        eventIds: events.filter((event) => event.nodeId === nodeId).map((event) => event.id),
      })),
      edges: [],
    },
    chat: {
      runId: run.id,
      messages: events.map((event) => ({
        id: `${event.id}:chat`,
        eventId: event.id,
        speaker: event.type === 'final_artifact'
          ? 'finalizer'
          : event.type === 'router_decision' || event.type === 'router_output'
            ? 'router'
            : 'participant',
        content: event.message,
        roleSlotId: event.roleSlotId,
        route: event.route,
        createdAt: event.createdAt,
      })),
    },
  };
}

function agentFlowTraceToArchitectureEvent(event: AgentFlowTraceItem, runId: string): ArchitectureExecutionEvent {
  const eventType = typeof event.type === 'string' ? event.type : 'runtime_note';
  const rawType = eventType.startsWith('architecture:') ? eventType.slice('architecture:'.length) : eventType;
  return {
    id: event.id,
    runId,
    sequence: event.sequence,
    type: rawType as ArchitectureExecutionEvent['type'],
    message: event.message ?? rawType,
    nodeId: event.nodeId,
    roleSlotId: event.roleSlotId,
    route: event.route,
    data: event.data,
    createdAt: event.createdAt,
  };
}

export async function resumeGoalGuardAgentFlowRunWithQualityGate(
  runId: string,
  prompt: string,
  context: Record<string, unknown> | undefined,
  gate: ExternalQualityGateInput,
  maxSteps?: number,
): Promise<ArchitectRunResult> {
  const normalizedGate = {
    source: gate.source.trim() || 'playwright',
    status: gate.status,
    highFindings: gate.highFindings,
    summary: gate.summary.trim(),
    ...(gate.artifactPath?.trim() ? { artifacts: [gate.artifactPath.trim()] } : {}),
  };
  const snapshot = await resumeAgentFlowRunApi(runId, {
    input: `Resume after external ${normalizedGate.source} QA evidence: ${normalizedGate.summary}`,
    context: {
      ...(context ?? {}),
      externalQualityGate: normalizedGate,
    },
    maxSteps,
  });
  return getGoalGuardAgentFlowRunResult(snapshot, prompt, {
    ...(context ?? {}),
    externalQualityGate: normalizedGate,
  });
}

export async function getArchitectureRunResult(run: ArchitectureRun): Promise<ArchitectRunResult> {
  const [eventsResponse, graphResponse, chatResponse] = await Promise.all([
    apiClient.get<ArchitectRunResult['events']>(`/api/architecture-runs/${run.id}/events`),
    apiClient.get<ArchitectRunResult['graph']>(`/api/architecture-runs/${run.id}/graph`),
    apiClient.get<ArchitectRunResult['chat']>(`/api/architecture-runs/${run.id}/chat`),
  ]);
  return {
    run,
    events: eventsResponse.data,
    graph: graphResponse.data,
    chat: chatResponse.data,
  };
}

export async function getArchitectSessions(): Promise<ChatSession[]> {
  const [sessionsResponse, agentFlowResponse] = await Promise.all([
    apiClient.get<ChatSession[]>('/api/sessions'),
    apiClient.get<AgentFlowRunSnapshot[]>('/api/agent-flows/runs?parentSessionId=architect-ui'),
  ]);
  const existingIds = new Set(sessionsResponse.data.map((session) => session.id));
  const agentFlowSessions = agentFlowResponse.data
    .map(agentFlowSnapshotToSession)
    .filter((session) => !existingIds.has(session.id));
  return [...sessionsResponse.data, ...agentFlowSessions]
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

function agentFlowSnapshotToSession(snapshot: AgentFlowRunSnapshot): ChatSession {
  const sessionId = snapshot.run.openChatSessionId ?? snapshot.result?.openChatSessionId ?? snapshot.run.childSessionId;
  return {
    id: sessionId,
    personaId: 'default',
    title: `AgentFlow: ${snapshot.run.flowDefinitionId} (${snapshot.run.status})`,
    kind: 'agent-flow',
    parentSessionId: snapshot.run.parentSessionId,
    createdAt: snapshot.run.createdAt,
    updatedAt: snapshot.run.updatedAt,
  };
}
