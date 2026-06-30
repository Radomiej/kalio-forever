import type {
  ChatMessage,
  ChatSession,
  CLIAgentResult,
  CLIAgentSessionSnapshot,
  RuntimeActivitySnapshot,
  RuntimeChildExecution,
} from '@kalio/types';
import type { ToolActivityStatus } from '../../store/agentRuntimeTypes';
import { extractCLIAgentResult, extractCLIAgentSessionSnapshot, extractPersistedToolResultMeta } from './ToolCallBubble.parsers';

export const CLI_CHILD_DELEGATION_TOOLS = new Set([
  'run_cli_agent',
  'spawn_cli_agent',
]);

export const CLI_SESSION_TOOLS = new Set([
  'spawn_cli_agent',
  'message_cli_agent',
  'get_cli_agent_status',
  'stop_cli_agent',
]);

export type CLIChildProjectionStatus = 'running' | 'completed' | 'failed' | 'stopped' | 'pending';

export interface CLIChildProjection {
  childSessionId: string;
  parentSessionId: string;
  parentCallId: string;
  turnId?: string;
  agentId: string;
  status: CLIChildProjectionStatus;
  lastOutput: string;
  childTitle?: string;
  toolName: string;
  isPending?: boolean;
}

export function isCliChildDelegationTool(toolName: string): boolean {
  return CLI_CHILD_DELEGATION_TOOLS.has(toolName);
}

export function isCliChildToolName(toolName: string): boolean {
  return isCliChildDelegationTool(toolName) || CLI_SESSION_TOOLS.has(toolName);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function stringOrEmpty(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export function terminalProjectionStatus(
  resultStatus: 'success' | 'error' | 'cancelled',
): CLIChildProjectionStatus | null {
  if (resultStatus === 'cancelled') return 'stopped';
  if (resultStatus === 'error') return 'failed';
  return null;
}

export function isTerminalCliChildStatus(status: CLIChildProjectionStatus | null | undefined): boolean {
  return status === 'completed' || status === 'failed' || status === 'stopped';
}

export function shouldRenderLiveCliChildStatus(status: CLIChildProjectionStatus): boolean {
  return status === 'running' || status === 'pending';
}

export function mapSnapshotStatus(status: string | undefined): CLIChildProjectionStatus {
  if (status === 'running') return 'running';
  if (status === 'completed') return 'completed';
  if (status === 'failed') return 'failed';
  if (status === 'stopped') return 'stopped';
  return 'pending';
}

export function mapRuntimeChildExecutionStatus(status: RuntimeChildExecution['status']): CLIChildProjectionStatus {
  if (status === 'completed') return 'completed';
  if (status === 'failed' || status === 'blocked') return 'failed';
  if (status === 'cancelled' || status === 'stopped') return 'stopped';
  if (status === 'running') return 'running';
  return 'pending';
}

function projectionStatusFromActivityStatus(status: ToolActivityStatus | undefined): CLIChildProjectionStatus | null {
  if (status === 'running' || status === 'awaiting_confirmation') return 'running';
  if (status === 'success') return 'completed';
  if (status === 'cancelled') return 'stopped';
  if (status === 'error' || status === 'expired') return 'failed';
  return null;
}

function projectionStatusFromCliResult(cliResult: CLIAgentResult | null): CLIChildProjectionStatus | null {
  if (!cliResult) {
    return null;
  }
  return cliResult.exitCode === 0 ? 'completed' : 'failed';
}

export function resolveCLIChildProjectionStatus(params: {
  snapshotStatus?: string;
  liveProjectionStatus?: CLIChildProjectionStatus;
  activityStatus?: ToolActivityStatus;
  resultStatus?: 'success' | 'error' | 'cancelled';
  cliResult?: CLIAgentResult | null;
}): CLIChildProjectionStatus {
  const mappedSnapshotStatus = mapSnapshotStatus(params.snapshotStatus);
  const liveProjectionStatus = params.liveProjectionStatus ?? null;
  const activityProjectionStatus = projectionStatusFromActivityStatus(params.activityStatus);
  const terminalResultStatus = params.resultStatus
    ? terminalProjectionStatus(params.resultStatus)
    : projectionStatusFromCliResult(params.cliResult ?? null);

  if (isTerminalCliChildStatus(mappedSnapshotStatus)) {
    return mappedSnapshotStatus;
  }
  if (
    liveProjectionStatus === 'completed'
    || liveProjectionStatus === 'failed'
    || liveProjectionStatus === 'stopped'
  ) {
    return liveProjectionStatus;
  }
  if (terminalResultStatus) {
    return terminalResultStatus;
  }
  if (mappedSnapshotStatus !== 'pending') {
    return mappedSnapshotStatus;
  }
  if (liveProjectionStatus && liveProjectionStatus !== 'pending') {
    return liveProjectionStatus;
  }
  if (activityProjectionStatus != null) {
    return activityProjectionStatus;
  }

  return 'pending';
}

export function projectionFromSession(
  session: ChatSession,
  toolName = 'spawn_cli_agent',
): CLIChildProjection | null {
  if (session.kind !== 'cli-agent' || !session.parentSessionId || !session.parentToolCallId) {
    return null;
  }
  return {
    childSessionId: session.id,
    parentSessionId: session.parentSessionId,
    parentCallId: session.parentToolCallId,
    agentId: agentIdFromSession(session),
    status: 'running',
    lastOutput: '',
    childTitle: session.title,
    toolName,
  };
}

function agentIdFromSession(session: ChatSession): string {
  const typedAgentId = session.runtimeContext?.cliAgentContext?.agentId?.trim();
  if (typedAgentId) {
    return typedAgentId;
  }
  // TODO: legacy fallback for CLI sessions created before runtimeContext.cliAgentContext existed.
  const legacyTitleMatch = /^(codex|gemini|copilot|claude)\s+CLI\b/i.exec(session.title.trim());
  return legacyTitleMatch?.[1]?.toLowerCase() ?? 'copilot';
}

export function projectionFromToolResult(
  toolName: string,
  callId: string,
  parentSessionId: string,
  data: unknown,
  resultStatus?: 'success' | 'error' | 'cancelled',
): CLIChildProjection | null {
  if (!isCliChildDelegationTool(toolName) && !CLI_SESSION_TOOLS.has(toolName)) {
    return null;
  }

  const snapshot = extractCLIAgentSessionSnapshot(data);
  if (snapshot) {
    return {
      childSessionId: snapshot.childSessionId,
      parentSessionId: snapshot.parentSessionId || parentSessionId,
      parentCallId: callId,
      agentId: snapshot.agentId,
      status: resolveCLIChildProjectionStatus({
        snapshotStatus: snapshot.status,
        resultStatus,
      }),
      lastOutput: snapshot.lastOutput ?? '',
      toolName,
    };
  }

  const cliResult = extractCLIAgentResult(data);
  if (cliResult?.childSessionId) {
    return {
      childSessionId: cliResult.childSessionId,
      parentSessionId,
      parentCallId: callId,
      agentId: cliResult.agentId,
      status: resolveCLIChildProjectionStatus({ cliResult }),
      lastOutput: cliResult.output,
      toolName,
    };
  }

  return null;
}

export function projectionFromRuntimeChildExecution(
  execution: RuntimeChildExecution,
  fallbackToolName = 'run_cli_agent',
): CLIChildProjection | null {
  if (execution.kind !== 'cli_agent' || !execution.parentToolCallId) {
    return null;
  }

  return {
    childSessionId: execution.childSessionId,
    parentSessionId: execution.parentSessionId,
    parentCallId: execution.parentToolCallId,
    agentId: execution.label ?? 'copilot',
    status: mapRuntimeChildExecutionStatus(execution.status),
    lastOutput: stringOrEmpty(execution.lastOutput),
    toolName: fallbackToolName,
  };
}

export function projectionFromRuntimeSnapshots(
  snapshots: Record<string, RuntimeActivitySnapshot> | null | undefined,
  params: { childSessionId?: string; parentCallId?: string },
): CLIChildProjection | null {
  for (const snapshot of Object.values(snapshots ?? {})) {
    for (const execution of snapshot.childExecutions) {
      const projection = projectionFromRuntimeChildExecution(execution);
      if (!projection) {
        continue;
      }
      if (params.childSessionId && projection.childSessionId === params.childSessionId) {
        return projection;
      }
      if (params.parentCallId && projection.parentCallId === params.parentCallId) {
        return projection;
      }
    }
  }

  return null;
}

export function findStoredCLIChildProjection(
  projections: Record<string, CLIChildProjection> | null | undefined,
  params: { childSessionId?: string; parentCallId?: string },
): CLIChildProjection | null {
  if (params.childSessionId) {
    const direct = projections?.[params.childSessionId];
    if (direct) {
      return direct;
    }
  }

  if (!params.parentCallId) {
    return null;
  }

  return Object.values(projections ?? {}).find((item) => item.parentCallId === params.parentCallId) ?? null;
}

export function mergeCLIChildProjectionSources(params: {
  runtimeProjection?: CLIChildProjection | null;
  storedProjection?: CLIChildProjection | null;
}): CLIChildProjection | null {
  const runtimeProjection = params.runtimeProjection ?? null;
  const storedProjection = params.storedProjection ?? null;

  if (!runtimeProjection) {
    return storedProjection;
  }

  if (!storedProjection) {
    return runtimeProjection;
  }

  return {
    childSessionId: runtimeProjection.childSessionId,
    parentSessionId: runtimeProjection.parentSessionId || storedProjection.parentSessionId,
    parentCallId: runtimeProjection.parentCallId || storedProjection.parentCallId,
    turnId: runtimeProjection.turnId ?? storedProjection.turnId,
    agentId: runtimeProjection.agentId !== 'copilot'
      ? runtimeProjection.agentId
      : storedProjection.agentId || runtimeProjection.agentId,
    status: runtimeProjection.status,
    lastOutput: nonEmptyString(runtimeProjection.lastOutput)
      ? runtimeProjection.lastOutput
      : storedProjection.lastOutput,
    childTitle: storedProjection.childTitle ?? runtimeProjection.childTitle,
    toolName: storedProjection.toolName || runtimeProjection.toolName,
    isPending: runtimeProjection.isPending === true || storedProjection.isPending === true,
  };
}

export function selectCLIChildProjectionFromSources(params: {
  runtimeActivitySnapshots: Record<string, RuntimeActivitySnapshot> | null | undefined;
  cliChildProjections: Record<string, CLIChildProjection> | null | undefined;
  childSessionId?: string;
  parentCallId?: string;
}): CLIChildProjection | null {
  return mergeCLIChildProjectionSources({
    runtimeProjection: projectionFromRuntimeSnapshots(params.runtimeActivitySnapshots, params),
    storedProjection: findStoredCLIChildProjection(params.cliChildProjections, params),
  });
}

export function rebuildCLIChildProjectionsFromMessages(
  parentSessionId: string,
  messages: ChatMessage[],
  callIdToName: Record<string, string>,
): CLIChildProjection[] {
  const projections = new Map<string, CLIChildProjection>();

  for (const message of messages) {
    if (message.role !== 'tool_result' || !message.toolCallId) continue;
    const toolName = callIdToName[message.toolCallId];
    if (!toolName || (!isCliChildDelegationTool(toolName) && !CLI_SESSION_TOOLS.has(toolName))) {
      continue;
    }

    // TODO: legacy fallback for persisted histories created before runtime childExecutions were projected.
    let parsed: unknown;
    try {
      parsed = JSON.parse(message.content);
    } catch {
      continue;
    }

    const projection = projectionFromToolResult(
      toolName,
      message.toolCallId,
      parentSessionId,
      parsed,
      extractPersistedToolResultMeta(parsed)?.status,
    );
    if (projection) {
      projections.set(projection.childSessionId, projection);
    }
  }

  return [...projections.values()];
}

export function mergeCliOutput(
  projection: CLIChildProjection,
  liveOutput: string | undefined,
  snapshot: CLIAgentSessionSnapshot | null,
  cliResult: CLIAgentResult | null,
): string {
  if (liveOutput && liveOutput.trim().length > 0) return liveOutput;
  if (snapshot?.lastOutput?.trim()) return snapshot.lastOutput;
  if (cliResult?.output?.trim()) return cliResult.output;
  return projection.lastOutput;
}
