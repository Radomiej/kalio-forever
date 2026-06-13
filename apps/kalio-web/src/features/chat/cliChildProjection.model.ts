import type { ChatMessage, ChatSession, CLIAgentResult, CLIAgentSessionSnapshot } from '@kalio/types';
import type { ToolActivityStatus } from '../../store/agentStore';
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
  agentId: string;
  status: CLIChildProjectionStatus;
  lastOutput: string;
  childTitle?: string;
  toolName: string;
}

export function isCliChildDelegationTool(toolName: string): boolean {
  return CLI_CHILD_DELEGATION_TOOLS.has(toolName);
}

export function isCliChildToolName(toolName: string): boolean {
  return isCliChildDelegationTool(toolName) || CLI_SESSION_TOOLS.has(toolName);
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
    agentId: session.title.split(' CLI')[0] ?? 'copilot',
    status: 'running',
    lastOutput: '',
    childTitle: session.title,
    toolName,
  };
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
