import type { ChatMessage, ChatSession, CLIAgentResult, CLIAgentSessionSnapshot } from '@kalio/types';
import { extractCLIAgentResult, extractCLIAgentSessionSnapshot } from './ToolCallBubble.parsers';

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

export function mapSnapshotStatus(status: string | undefined): CLIChildProjectionStatus {
  if (status === 'running') return 'running';
  if (status === 'completed') return 'completed';
  if (status === 'failed') return 'failed';
  if (status === 'stopped') return 'stopped';
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
      status: mapSnapshotStatus(snapshot.status),
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
      status: cliResult.exitCode === 0 ? 'completed' : 'failed',
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

    const projection = projectionFromToolResult(toolName, message.toolCallId, parentSessionId, parsed);
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
