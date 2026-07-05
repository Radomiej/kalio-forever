import type {
  AgentBudgetApprovalRequest,
  AgentFlowRunSnapshot,
  AgentFlowRunStatus,
  ChatMessage,
  ChatSession,
  CLIAgentSessionSnapshot,
  CLIAgentSessionStatus,
  RuntimeChildExecutionStatus,
  SocketEvents,
  ToolBudgetProgress,
} from '@kalio/types';
import type { AgentBudgetApprovalService } from './agent-budget-approval.service';
import type { SessionPipelineService } from './session-pipeline.service';
import type { SessionsService } from './sessions.service';
import type { ToolDispatchService } from './tool-dispatch.service';
import type { AgentFlowRuntimePort } from '../agent-flow/agent-flow-runtime.port';
import type { CLIAgentSessionRuntimePort } from '../cli-agent/cli-agent-session-runtime.port';
import type { ActiveSubagentRunStatus, SubagentRuntimePort } from '../tool/subagent-runtime.port';
import { readPendingRAAppLaunchIntent } from './raapp-launch-intent';
import { isWorkflowError } from '../../common/utils/workflow-error.util';
import { safeLoadRuntimeSnapshotSessionMetadata } from './chat.runtime-session-metadata';

interface RuntimeSnapshotLogger {
  warn(message: string): void;
}

export interface RuntimeActivitySnapshotDeps {
  sessionId: string;
  status?: SocketEvents['session:status'];
  pipeline: Pick<SessionPipelineService, 'getSessionStatusWithRun'>;
  toolDispatch: Pick<ToolDispatchService, 'getPendingConfirmations'>;
  agentBudgetApprovals: Pick<AgentBudgetApprovalService, 'getPendingApprovals'>;
  sessionsService: Pick<SessionsService, 'listChildren' | 'get' | 'getMessages'>;
  agentFlowRuntime?: AgentFlowRuntimePort;
  cliAgentSessionRuntime?: CLIAgentSessionRuntimePort;
  subagentRuntime?: Pick<SubagentRuntimePort, 'getActiveRunStatus'>;
  logger?: RuntimeSnapshotLogger;
}

export interface RuntimeSnapshotSessionTree {
  rootSessionId: string;
  sessionIds: string[];
  directChildIdsBySessionId: Record<string, string[]>;
  descendantIdsBySessionId: Record<string, string[]>;
  childSessionsById: Record<string, ChatSession>;
}

export interface RuntimeActivitySnapshotBatchResult {
  sessionIds: string[];
  sessionTree: RuntimeSnapshotSessionTree;
  statusesBySessionId: Record<string, SocketEvents['session:status']>;
  snapshotsBySessionId: Record<string, SocketEvents['session:runtime_snapshot']>;
}

interface RuntimeActivitySnapshotBatchDeps extends Omit<RuntimeActivitySnapshotDeps, 'sessionId' | 'status'> {
  rootSessionId: string;
  sessionTree?: RuntimeSnapshotSessionTree;
  statusesBySessionId?: Record<string, SocketEvents['session:status']>;
}

type UnresolvedToolCall = { callId: string; toolName: string; args: Record<string, unknown> };

function isCliMetadataMissingError(error: unknown): boolean {
  return isWorkflowError(error, 'CLI_AGENT_SESSION_METADATA_MISSING');
}

function mapAgentFlowStatus(status: AgentFlowRunStatus): RuntimeChildExecutionStatus {
  if (status === 'done') return 'completed';
  if (status === 'failed') return 'failed';
  if (status === 'blocked') return 'blocked';
  if (status === 'cancelled') return 'cancelled';
  if (status === 'waiting_on_orchestrator') return 'waiting';
  return 'running';
}

function mapCliStatus(status: CLIAgentSessionStatus): RuntimeChildExecutionStatus {
  if (status === 'completed') return 'completed';
  if (status === 'failed') return 'failed';
  if (status === 'stopped') return 'stopped';
  if (status === 'running') return 'running';
  return 'idle';
}

function mapSubagentStatus(status: SocketEvents['session:status']): RuntimeChildExecutionStatus {
  if (status.run?.status === 'completed' || status.run?.phase === 'completed') {
    return 'completed';
  }
  if (status.run?.status === 'interrupted_needs_retry' || status.run?.status === 'interrupted') {
    return 'stopped';
  }
  if (status.run?.status === 'failed') {
    return 'failed';
  }
  if ((status.queueLength ?? 0) > 0) {
    return 'waiting';
  }
  if (status.active) {
    return 'running';
  }
  return 'completed';
}

function latestUnresolvedToolCall(messages: ChatMessage[]): UnresolvedToolCall | null {
  const resolvedToolCallIds = new Set(
    messages
      .filter((message) => message.role === 'tool_result' && typeof message.toolCallId === 'string')
      .map((message) => message.toolCallId as string),
  );

  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = messages[messageIndex];
    if (message.role !== 'assistant' || !message.toolCalls?.length) {
      continue;
    }
    for (let toolIndex = message.toolCalls.length - 1; toolIndex >= 0; toolIndex -= 1) {
      const toolCall = message.toolCalls[toolIndex];
      if (resolvedToolCallIds.has(toolCall.id)) {
        continue;
      }
      return {
        callId: toolCall.id,
        toolName: toolCall.name,
        args: toolCall.args,
      };
    }
  }

  return null;
}

export async function collectRuntimeSnapshotSessionTree(
  rootSessionId: string,
  sessionsService: Pick<SessionsService, 'listChildren'>,
): Promise<RuntimeSnapshotSessionTree> {
  const directChildIdsBySessionId: Record<string, string[]> = {};
  const childSessionsById: Record<string, ChatSession> = {};
  const sessionIds = [rootSessionId];
  const pending = [rootSessionId];
  const seen = new Set<string>(pending);

  while (pending.length > 0) {
    const currentSessionId = pending.shift();
    if (!currentSessionId) {
      break;
    }

    const children = await sessionsService.listChildren(currentSessionId);
    const directChildIds: string[] = [];
    const directChildSeen = new Set<string>();
    children.forEach((child) => {
      if (child.id === currentSessionId || directChildSeen.has(child.id)) {
        return;
      }
      directChildSeen.add(child.id);
      directChildIds.push(child.id);
      childSessionsById[child.id] = child;
      if (seen.has(child.id)) {
        return;
      }
      seen.add(child.id);
      sessionIds.push(child.id);
      pending.push(child.id);
    });
    directChildIdsBySessionId[currentSessionId] = directChildIds;
  }

  const descendantMemo = new Map<string, string[]>();
  const collectDescendants = (sessionId: string, visiting = new Set<string>()): string[] => {
    const cached = descendantMemo.get(sessionId);
    if (cached) {
      return cached;
    }
    if (visiting.has(sessionId)) {
      return [];
    }
    visiting.add(sessionId);
    const directChildren = directChildIdsBySessionId[sessionId] ?? [];
    const descendants: string[] = [];
    const descendantSeen = new Set<string>();
    directChildren.forEach((childId) => {
      if (childId === sessionId || visiting.has(childId) || descendantSeen.has(childId)) {
        return;
      }
      descendantSeen.add(childId);
      descendants.push(childId);
      collectDescendants(childId, visiting).forEach((descendantId) => {
        if (descendantSeen.has(descendantId)) {
          return;
        }
        descendantSeen.add(descendantId);
        descendants.push(descendantId);
      });
    });
    visiting.delete(sessionId);
    descendantMemo.set(sessionId, descendants);
    return descendants;
  };

  const descendantIdsBySessionId: Record<string, string[]> = {};
  sessionIds.forEach((sessionId) => {
    descendantIdsBySessionId[sessionId] = collectDescendants(sessionId);
  });

  return {
    rootSessionId,
    sessionIds,
    directChildIdsBySessionId,
    descendantIdsBySessionId,
    childSessionsById,
  };
}

async function preloadSessionStatuses(
  sessionIds: string[],
  pipeline: Pick<SessionPipelineService, 'getSessionStatusWithRun'>,
  existingStatusesBySessionId: Record<string, SocketEvents['session:status']> | undefined,
): Promise<Record<string, SocketEvents['session:status']>> {
  const statusesBySessionId: Record<string, SocketEvents['session:status']> = {
    ...(existingStatusesBySessionId ?? {}),
  };

  await Promise.all(sessionIds.map(async (sessionId) => {
    if (statusesBySessionId[sessionId]) {
      return;
    }
    statusesBySessionId[sessionId] = await pipeline.getSessionStatusWithRun(sessionId);
  }));

  return statusesBySessionId;
}

async function preloadAgentFlowSnapshotsByParentSessionId(
  sessionIds: string[],
  agentFlowRuntime: AgentFlowRuntimePort | undefined,
): Promise<Record<string, AgentFlowRunSnapshot[]>> {
  if (!agentFlowRuntime) {
    return {};
  }

  if (agentFlowRuntime.findByParentSessionId) {
    const entries = await Promise.all(sessionIds.map(async (sessionId) => (
      [sessionId, await agentFlowRuntime.findByParentSessionId!(sessionId)] as const
    )));
    return Object.fromEntries(entries);
  }

  if (!agentFlowRuntime.findAll) {
    return {};
  }

  const allSnapshots = await agentFlowRuntime.findAll();
  return Object.fromEntries(sessionIds.map((sessionId) => (
    [sessionId, allSnapshots.filter((snapshot) => snapshot.run.parentSessionId === sessionId)] as const
  )));
}

function preloadActiveSubagentStatuses(
  sessionIds: string[],
  subagentRuntime: Pick<SubagentRuntimePort, 'getActiveRunStatus'> | undefined,
): Record<string, SocketEvents['session:status']> {
  if (!subagentRuntime?.getActiveRunStatus) {
    return {};
  }

  const now = Date.now();
  const entries = sessionIds
    .map((sessionId) => subagentRuntime.getActiveRunStatus?.(sessionId))
    .filter((status): status is ActiveSubagentRunStatus => status !== null && status !== undefined)
    .map((status) => [status.sessionId, activeSubagentStatus(status, now)] as const);
  return Object.fromEntries(entries);
}

function activeSubagentStatus(
  status: ActiveSubagentRunStatus,
  now: number,
): SocketEvents['session:status'] {
  return {
    sessionId: status.sessionId,
    active: true,
    turnId: status.turnId,
    queueLength: 0,
    run: {
      id: status.agentRun?.agentRunId ?? status.turnId,
      sessionId: status.sessionId,
      turnId: status.turnId,
      phase: 'llm_streaming',
      status: 'active',
      retryCount: 0,
      safeResume: false,
      startedAt: now,
      updatedAt: now,
      lastHeartbeatAt: now,
    },
  };
}

function buildToolActivitiesForSession(params: {
  sessionId: string;
  runtimeStatus: SocketEvents['session:status'];
  pendingConfirmations: ReturnType<ToolDispatchService['getPendingConfirmations']>;
  unresolvedTool: UnresolvedToolCall | null;
}): SocketEvents['session:runtime_snapshot']['toolActivities'] {
  const updatedAt = Date.now();
  const toolActivities: SocketEvents['session:runtime_snapshot']['toolActivities'] = params.pendingConfirmations.map((request) => ({
    callId: request.toolCallId,
    requestId: request.requestId,
    sessionId: request.sessionId,
    toolName: request.toolName,
    args: request.args,
    status: 'pending_confirmation',
    startedAt: updatedAt,
  }));

  if (
    params.runtimeStatus.run?.phase === 'tool_running'
    && params.unresolvedTool
    && !toolActivities.some((activity) => activity.callId === params.unresolvedTool?.callId)
  ) {
    toolActivities.push({
      callId: params.unresolvedTool.callId,
      sessionId: params.sessionId,
      toolName: params.unresolvedTool.toolName,
      args: params.unresolvedTool.args,
      status: 'running',
      startedAt: params.runtimeStatus.run.startedAt,
    });
  }

  return toolActivities;
}

function buildChildExecutionsForSession(params: {
  sessionId: string;
  updatedAt: number;
  sessionTree: RuntimeSnapshotSessionTree;
  agentFlowSnapshotsByParentSessionId: Record<string, AgentFlowRunSnapshot[]>;
  cliSnapshotsByChildSessionId: Record<string, CLIAgentSessionSnapshot>;
  subagentStatusesBySessionId: Record<string, SocketEvents['session:status']>;
}): SocketEvents['session:runtime_snapshot']['childExecutions'] {
  const childExecutions: SocketEvents['session:runtime_snapshot']['childExecutions'] = [];

  (params.agentFlowSnapshotsByParentSessionId[params.sessionId] ?? []).forEach((snapshot) => {
    const childSessionId = snapshot.run.openChatSessionId ?? snapshot.run.childSessionId;
    const childSessionTitle = params.sessionTree.childSessionsById[childSessionId]?.title;
    childExecutions.push({
      id: snapshot.run.id,
      kind: 'agent_flow',
      parentSessionId: snapshot.run.parentSessionId,
      childSessionId,
      parentToolCallId: snapshot.run.parentToolCallId,
      flowRunId: snapshot.run.openGraphRunId ?? snapshot.run.id,
      label: snapshot.run.summary ?? childSessionTitle,
      status: mapAgentFlowStatus(snapshot.run.status),
      updatedAt: snapshot.run.updatedAt ?? params.updatedAt,
    });
  });

  (params.sessionTree.descendantIdsBySessionId[params.sessionId] ?? []).forEach((descendantSessionId) => {
    const childSession = params.sessionTree.childSessionsById[descendantSessionId];
    if (!childSession) {
      return;
    }

    if (childSession.kind === 'cli-agent' && childSession.parentSessionId) {
      const cliSnapshot = params.cliSnapshotsByChildSessionId[childSession.id];
      if (!cliSnapshot) {
        return;
      }
      childExecutions.push({
        id: cliSnapshot.activeCallId ?? cliSnapshot.childSessionId,
        kind: 'cli_agent',
        parentSessionId: cliSnapshot.parentSessionId,
        childSessionId: cliSnapshot.childSessionId,
        parentToolCallId: childSession.parentToolCallId,
        cliRunId: cliSnapshot.activeCallId,
        label: cliSnapshot.agentId,
        status: mapCliStatus(cliSnapshot.status),
        errorCode: cliSnapshot.errorCode,
        failure: cliSnapshot.failure,
        lastOutput: cliSnapshot.lastOutput,
        updatedAt: cliSnapshot.updatedAt,
      });
      return;
    }

    if (
      childSession.kind === 'subagent'
      && childSession.parentSessionId
      && childSession.parentToolCallId
    ) {
      const childStatus = params.subagentStatusesBySessionId[childSession.id];
      if (!childStatus) {
        return;
      }
      if (!childStatus.active && (childStatus.queueLength ?? 0) === 0 && !childStatus.run) {
        return;
      }
      childExecutions.push({
        id: childSession.id,
        kind: 'subagent',
        parentSessionId: childSession.parentSessionId,
        childSessionId: childSession.id,
        parentToolCallId: childSession.parentToolCallId,
        label: childSession.title,
        status: mapSubagentStatus(childStatus),
        updatedAt: childSession.updatedAt,
      });
    }
  });

  return childExecutions;
}

export async function buildRuntimeActivitySnapshotBatch({
  rootSessionId,
  pipeline,
  toolDispatch,
  agentBudgetApprovals,
  sessionsService,
  agentFlowRuntime,
  cliAgentSessionRuntime,
  subagentRuntime,
  logger,
  sessionTree,
  statusesBySessionId: existingStatusesBySessionId,
}: RuntimeActivitySnapshotBatchDeps): Promise<RuntimeActivitySnapshotBatchResult> {
  const resolvedSessionTree = sessionTree ?? await collectRuntimeSnapshotSessionTree(rootSessionId, sessionsService);
  const sessionIds = resolvedSessionTree.sessionIds;
  const statusesBySessionId = await preloadSessionStatuses(sessionIds, pipeline, existingStatusesBySessionId);
  const pendingConfirmationsBySessionId = Object.fromEntries(
    sessionIds.map((sessionId) => [sessionId, toolDispatch.getPendingConfirmations(sessionId)]),
  );
  const pendingBudgetApprovalsBySessionId = Object.fromEntries(
    sessionIds.map((sessionId) => [sessionId, agentBudgetApprovals.getPendingApprovals(sessionId)]),
  );

  const messagesBySessionId: Record<string, ChatMessage[]> = {};
  await Promise.all(sessionIds.map(async (sessionId) => {
    if (statusesBySessionId[sessionId]?.run?.phase !== 'tool_running') {
      return;
    }
    messagesBySessionId[sessionId] = await sessionsService.getMessages(sessionId).catch((err: unknown) => {
      logger?.warn(
        `Unable to load session messages ${sessionId} for runtime snapshot: ${err instanceof Error ? err.message : String(err)}`,
      );
      return [];
    });
  }));

  const agentFlowSnapshotsByParentSessionId = await preloadAgentFlowSnapshotsByParentSessionId(sessionIds, agentFlowRuntime);
  const activeSubagentStatusesBySessionId = preloadActiveSubagentStatuses(sessionIds, subagentRuntime);
  const rootSession = await safeLoadRuntimeSnapshotSessionMetadata(rootSessionId, sessionsService, logger);
  const sessionsBySessionId: Record<string, ChatSession> = {
    ...(rootSession ? { [rootSessionId]: rootSession } : {}),
    ...resolvedSessionTree.childSessionsById,
  };

  const cliSnapshotsByChildSessionId: Record<string, CLIAgentSessionSnapshot> = {};
  const subagentStatusesBySessionId: Record<string, SocketEvents['session:status']> = {};
  await Promise.all(Object.values(resolvedSessionTree.childSessionsById).map(async (childSession) => {
    if (childSession.kind === 'cli-agent' && childSession.parentSessionId && cliAgentSessionRuntime?.getStatus) {
      const cliSnapshot = await cliAgentSessionRuntime.getStatus(childSession.parentSessionId, childSession.id).catch((err: unknown) => {
        if (isCliMetadataMissingError(err)) {
          return null;
        }
        logger?.warn(
          `Unable to load CLI child status ${childSession.id} for runtime snapshot: ${err instanceof Error ? err.message : String(err)}`,
        );
        return null;
      });
      if (cliSnapshot) {
        cliSnapshotsByChildSessionId[childSession.id] = cliSnapshot;
      }
      return;
    }

    if (
      childSession.kind === 'subagent'
      && childSession.parentSessionId
      && childSession.parentToolCallId
    ) {
      subagentStatusesBySessionId[childSession.id] = activeSubagentStatusesBySessionId[childSession.id]
        ?? statusesBySessionId[childSession.id]
        ?? await pipeline.getSessionStatusWithRun(childSession.id).catch((err: unknown) => {
          logger?.warn(
            `Unable to load subagent child status ${childSession.id} for runtime snapshot: ${err instanceof Error ? err.message : String(err)}`,
          );
          return null;
        }) ?? makeEmptyStatus(childSession.id);
    }
  }));

  const snapshotsBySessionId: Record<string, SocketEvents['session:runtime_snapshot']> = {};
  sessionIds.forEach((sessionId) => {
    const runtimeStatus = activeSubagentStatusesBySessionId[sessionId] ?? statusesBySessionId[sessionId];
    const pendingConfirmations = pendingConfirmationsBySessionId[sessionId] ?? [];
    const pendingBudgetApprovals = pendingBudgetApprovalsBySessionId[sessionId] ?? [];
    const updatedAt = Date.now();
    const toolBudgetProgress = toolBudgetProgressFromPendingApproval(pendingBudgetApprovals[0], updatedAt);
    const unresolvedTool = runtimeStatus.run?.phase === 'tool_running'
      ? latestUnresolvedToolCall(messagesBySessionId[sessionId] ?? [])
      : null;

    snapshotsBySessionId[sessionId] = {
      ...runtimeStatus,
      pendingConfirmations,
      pendingBudgetApprovals,
      ...(toolBudgetProgress ? { toolBudgetProgress } : {}),
      toolActivities: buildToolActivitiesForSession({
        sessionId,
        runtimeStatus,
        pendingConfirmations,
        unresolvedTool,
      }),
      childExecutions: buildChildExecutionsForSession({
        sessionId,
        updatedAt,
        sessionTree: resolvedSessionTree,
        agentFlowSnapshotsByParentSessionId,
        cliSnapshotsByChildSessionId,
        subagentStatusesBySessionId,
      }),
      ...(readPendingRAAppLaunchIntent(
        sessionId,
        sessionsBySessionId[sessionId]?.personaId ?? 'default',
        sessionsBySessionId[sessionId]?.runtimeContext,
      ) ? {
        raAppLaunchIntent: readPendingRAAppLaunchIntent(
          sessionId,
          sessionsBySessionId[sessionId]?.personaId ?? 'default',
          sessionsBySessionId[sessionId]?.runtimeContext,
        ) ?? undefined,
      } : {}),
      updatedAt,
    };
  });

  return {
    sessionIds,
    sessionTree: resolvedSessionTree,
    statusesBySessionId,
    snapshotsBySessionId,
  };
}

function toolBudgetProgressFromPendingApproval(
  approval: AgentBudgetApprovalRequest | undefined,
  updatedAt: number,
): ToolBudgetProgress | undefined {
  if (!approval) {
    return undefined;
  }
  return {
    sessionId: approval.sessionId,
    usedIterations: approval.usedIterations,
    currentLimit: approval.currentLimit,
    status: 'waiting',
    runtimeKind: approval.scope,
    personaId: approval.personaId,
    agentRun: approval.agentRun,
    nodeId: approval.nodeId,
    roleSlotId: approval.roleSlotId,
    updatedAt,
  };
}

function makeEmptyStatus(sessionId: string): SocketEvents['session:status'] {
  return {
    sessionId,
    active: false,
    queueLength: 0,
  };
}

export async function buildRuntimeActivitySnapshot({
  sessionId,
  status,
  pipeline,
  toolDispatch,
  agentBudgetApprovals,
  sessionsService,
  agentFlowRuntime,
  cliAgentSessionRuntime,
  subagentRuntime,
  logger,
}: RuntimeActivitySnapshotDeps): Promise<SocketEvents['session:runtime_snapshot']> {
  const batch = await buildRuntimeActivitySnapshotBatch({
    rootSessionId: sessionId,
    statusesBySessionId: status ? { [sessionId]: status } : undefined,
    pipeline,
    toolDispatch,
    agentBudgetApprovals,
    sessionsService,
    agentFlowRuntime,
    cliAgentSessionRuntime,
    subagentRuntime,
    logger,
  });

  return batch.snapshotsBySessionId[sessionId];
}
