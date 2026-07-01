import type { ChatMessage, ChatSession, CLIAgentSessionSnapshot, Persona, SubagentCopiedFile, SubagentToolResult } from '@kalio/types';
import type { RuntimeChildExecution } from '@kalio/types';
import type { ToolActivity } from '../../../store/agentStore';
import type { AgentTurn } from '../../../store/sessionStore';
import { extractCLIAgentResult, extractPersistedToolResultMeta } from '../ToolCallBubble.parsers';
import { isCliChildToolName, resolveCLIChildProjectionStatus, shouldRenderLiveCliChildStatus } from '../cliChildProjection.model';
export { extractSubAgentFlowResult } from '../subAgentFlowResult.parser';

export const NODE_WIDTH = 220;
export const NODE_HEIGHT = 112;
export const COLUMN_GAP = 72;
export const ROW_GAP = 44;
export const BOARD_PADDING_X = 28;
export const BOARD_PADDING_Y = 28;

export type ExecutionGraphNodeStatus = 'idle' | 'running' | 'waiting' | 'success' | 'error';

export function statusFromRuntimeChildExecution(
  status: RuntimeChildExecution['status'],
): ExecutionGraphNodeStatus {
  if (status === 'running') {
    return 'running';
  }
  if (status === 'waiting') {
    return 'waiting';
  }
  if (status === 'completed') {
    return 'success';
  }
  if (status === 'failed' || status === 'blocked' || status === 'stopped' || status === 'cancelled') {
    return 'error';
  }
  return 'idle';
}
export type ExecutionGraphArtifactKind = 'file' | 'image' | 'raapp';

export interface ExecutionGraphArtifact {
  id: string;
  kind: ExecutionGraphArtifactKind;
  label: string;
  subtitle: string;
  path?: string;
  preview?: string;
  payload: unknown;
}

export interface ToolSnapshot {
  callId: string;
  toolName: string;
  args: Record<string, unknown>;
  activity: ToolActivity | null;
  result: unknown;
}

export function basename(value: string): string {
  const normalized = value.replace(/\\/g, '/');
  const parts = normalized.split('/').filter(Boolean);
  return parts.at(-1) ?? value;
}

export function compactGraphText(value: string | null | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const cleaned = value
    .replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, ' ')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !/^<function=/i.test(line) && !/^<parameter=/i.test(line))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

  return cleaned || undefined;
}

export function safeParse(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    return content;
  }
}

export function extractSubagentResult(data: unknown): SubagentToolResult | null {
  if (!data || typeof data !== 'object') return null;
  const candidate = data as Record<string, unknown>;
  if (typeof candidate['childSessionId'] !== 'string' || typeof candidate['result'] !== 'string') {
    return null;
  }
  return candidate as unknown as SubagentToolResult;
}

export function extractCLIAgentSessionResult(data: unknown): CLIAgentSessionSnapshot | null {
  if (!data || typeof data !== 'object') return null;
  const candidate = data as Record<string, unknown>;
  if (typeof candidate['childSessionId'] !== 'string' || typeof candidate['agentId'] !== 'string') {
    return null;
  }

  const derivedStatus = typeof candidate['status'] === 'string'
    ? candidate['status']
    : typeof candidate['exitCode'] === 'number'
      ? candidate['exitCode'] === 0
        ? 'completed'
        : 'failed'
      : 'idle';

  return {
    childSessionId: candidate['childSessionId'],
    parentSessionId: typeof candidate['parentSessionId'] === 'string' ? candidate['parentSessionId'] : '',
    agentId: candidate['agentId'],
    workdir: typeof candidate['workdir'] === 'string' ? candidate['workdir'] : '',
    status: derivedStatus as CLIAgentSessionSnapshot['status'],
    lastPrompt: typeof candidate['lastPrompt'] === 'string' ? candidate['lastPrompt'] : '',
    updatedAt: typeof candidate['updatedAt'] === 'number' ? candidate['updatedAt'] : 0,
    startedAt: typeof candidate['startedAt'] === 'number' ? candidate['startedAt'] : undefined,
    completedAt: typeof candidate['completedAt'] === 'number' ? candidate['completedAt'] : undefined,
    activeCallId: typeof candidate['activeCallId'] === 'string' ? candidate['activeCallId'] : undefined,
    lastOutput: typeof candidate['lastOutput'] === 'string'
      ? candidate['lastOutput']
      : typeof candidate['output'] === 'string'
        ? candidate['output']
        : undefined,
    lastExitCode: typeof candidate['lastExitCode'] === 'number'
      ? candidate['lastExitCode']
      : typeof candidate['exitCode'] === 'number'
        ? candidate['exitCode']
        : undefined,
  };
}

export function extractSubagentContextPrompt(args: Record<string, unknown>): string | null {
  const candidateKeys = ['inputPrompt', 'prompt', 'task', 'message', 'instruction'];

  for (const key of candidateKeys) {
    const value = args[key];
    if (typeof value === 'string') {
      const normalized = value.replace(/\s+/g, ' ').trim();
      if (normalized.length > 0) {
        return normalized;
      }
    }
  }

  return null;
}

export function extractArtifactFromData(callId: string, data: unknown): ExecutionGraphArtifact | null {
  if (!data || typeof data !== 'object') return null;
  const candidate = data as Record<string, unknown>;
  const path = typeof candidate['path'] === 'string' ? candidate['path'] : undefined;
  const outputType = typeof candidate['output_type'] === 'string' ? candidate['output_type'] : undefined;
  const type = typeof candidate['type'] === 'string' ? candidate['type'] : undefined;
  const renderedContent = typeof candidate['renderedContent'] === 'string' ? candidate['renderedContent'] : undefined;
  const content = typeof candidate['content'] === 'string' ? candidate['content'] : undefined;

  if (typeof candidate['status'] === 'string' && candidate['status'] === 'ready' && (type === 'html' || type === 'gui')) {
    return {
      id: `artifact:${callId}:raapp`,
      kind: 'raapp',
      label: type === 'html' ? 'HTML app' : 'GUI app',
      subtitle: 'Interactive preview block',
      preview: renderedContent ?? content,
      payload: data,
    };
  }

  if (outputType === 'image' || (path && /\.(png|jpg|jpeg|gif|webp|svg)$/i.test(path))) {
    return {
      id: `artifact:${path ?? `${callId}:image`}`,
      kind: 'image',
      label: basename(path ?? 'generated-image'),
      subtitle: path ?? 'Generated image asset',
      path,
      preview: typeof candidate['message'] === 'string' ? candidate['message'] : undefined,
      payload: data,
    };
  }

  if (path) {
    return {
      id: `artifact:${path}`,
      kind: 'file',
      label: basename(path),
      subtitle: path,
      path,
      preview: typeof candidate['message'] === 'string' ? candidate['message'] : undefined,
      payload: data,
    };
  }

  return null;
}

function statusFromCliChild(
  activity: ToolActivity | null,
  resultData: unknown,
  toolName: string | undefined,
): ExecutionGraphNodeStatus | null {
  if (!toolName || !isCliChildToolName(toolName)) {
    return null;
  }

  const cliSnapshot = extractCLIAgentSessionResult(resultData);
  const cliResult = extractCLIAgentResult(resultData);
  const cliStatus = resolveCLIChildProjectionStatus({
    snapshotStatus: cliSnapshot?.status,
    activityStatus: activity?.status,
    resultStatus: extractPersistedToolResultMeta(resultData)?.status,
    cliResult,
  });

  if (shouldRenderLiveCliChildStatus(cliStatus)) {
    return 'running';
  }
  if (cliStatus === 'completed') {
    return 'success';
  }
  if (cliStatus === 'failed' || cliStatus === 'stopped') {
    return 'error';
  }
  return 'idle';
}

export function statusFromActivity(
  activity: ToolActivity | null,
  hasResult: boolean,
  resultData?: unknown,
  toolName?: string,
): ExecutionGraphNodeStatus {
  const cliStatus = resultData !== undefined ? statusFromCliChild(activity, resultData, toolName) : null;
  if (cliStatus) {
    return cliStatus;
  }
  if (activity?.status === 'error' || activity?.status === 'cancelled' || activity?.status === 'expired') {
    return 'error';
  }
  if (activity?.status === 'running') {
    return 'running';
  }
  if (activity?.status === 'awaiting_confirmation') {
    return 'waiting';
  }
  if (activity?.status === 'success' || hasResult) {
    return 'success';
  }
  return 'idle';
}

export function buildToolSnapshots(messages: ChatMessage[], toolActivities: ToolActivity[]): Map<string, ToolSnapshot> {
  const snapshots = new Map<string, ToolSnapshot>();

  messages.forEach((message) => {
    if (message.role !== 'assistant' || !message.toolCalls) return;

    message.toolCalls.forEach((toolCall) => {
      snapshots.set(toolCall.id, {
        callId: toolCall.id,
        toolName: toolCall.name,
        args: toolCall.args,
        activity: snapshots.get(toolCall.id)?.activity ?? null,
        result: snapshots.get(toolCall.id)?.result ?? null,
      });
    });
  });

  toolActivities.forEach((activity) => {
    const existing = snapshots.get(activity.callId);
    snapshots.set(activity.callId, {
      callId: activity.callId,
      toolName: activity.toolName,
      args: activity.args,
      activity,
      result: activity.result?.data ?? existing?.result ?? null,
    });
  });

  messages.forEach((message) => {
    if (message.role !== 'tool_result' || !message.toolCallId) return;
    const existing = snapshots.get(message.toolCallId);
    const result = safeParse(message.content);
    const cliAgentResult = extractCLIAgentSessionResult(result);
    const normalizedActivity = cliAgentResult
      ? existing?.activity
        ? {
            ...existing.activity,
            status: cliAgentResult.status === 'running'
              ? 'running'
              : cliAgentResult.status === 'failed'
                ? 'error'
                : cliAgentResult.status === 'stopped'
                  ? 'cancelled'
                  : cliAgentResult.status === 'completed'
                    ? 'success'
                    : existing.activity.status,
          }
        : cliAgentResult.status === 'running' || cliAgentResult.status === 'failed' || cliAgentResult.status === 'stopped'
          ? {
              callId: message.toolCallId,
              toolName: existing?.toolName ?? 'tool',
              args: existing?.args ?? {},
              sessionId: message.sessionId,
              status: cliAgentResult.status === 'running'
                ? 'running' as const
                : cliAgentResult.status === 'failed'
                  ? 'error' as const
                  : 'cancelled' as const,
              startedAt: cliAgentResult.startedAt ?? message.createdAt,
            }
          : null
      : existing?.activity ?? null;
    snapshots.set(message.toolCallId, {
      callId: message.toolCallId,
      toolName: existing?.toolName ?? 'tool',
      args: existing?.args ?? {},
      activity: normalizedActivity,
      result,
    });
  });

  return snapshots;
}

export function getFinalAnswerMessage(turn: AgentTurn, messageById: Map<string, ChatMessage>): ChatMessage | null {
  const textMessageIds = turn.items
    .filter((item): item is Extract<AgentTurn['items'][number], { kind: 'text' }> => item.kind === 'text')
    .map((item) => item.messageId);

  const candidates = textMessageIds
    .map((messageId) => messageById.get(messageId) ?? null)
    .filter((message): message is ChatMessage => (
      message !== null
      && typeof message.content === 'string'
      && message.content.trim().length > 0
    ));

  return candidates.at(-1) ?? null;
}

export function getTurnStatus(turn: AgentTurn, toolSnapshots: Map<string, ToolSnapshot>): ExecutionGraphNodeStatus {
  if (turn.error) return 'error';
  if (!turn.done) return 'running';

  const toolStatuses = turn.items
    .filter((item): item is Extract<AgentTurn['items'][number], { kind: 'tool' }> => item.kind === 'tool')
    .map((item) => {
      const snapshot = toolSnapshots.get(item.callId);
      return statusFromActivity(
        snapshot?.activity ?? null,
        snapshot?.result != null,
        snapshot?.result,
        snapshot?.toolName,
      );
    });

  if (toolStatuses.includes('error')) return 'error';
  if (toolStatuses.includes('waiting')) return 'waiting';
  if (toolStatuses.includes('running')) return 'running';
  return 'success';
}

export function formatTurnSubtitle(
  turn: AgentTurn,
  toolCount: number,
  sessionPersonaIdById: Map<string, string>,
): string {
  const actorLabel = turn.agentRun?.label ?? sessionPersonaIdById.get(turn.sessionId) ?? null;
  const toolLabel = toolCount === 0 ? 'no tools in cycle' : `${toolCount} tool${toolCount === 1 ? '' : 's'} in cycle`;
  return actorLabel ? `${actorLabel} - ${toolLabel}` : toolLabel;
}

export function uniqueMessages(sessionMessages: Record<string, ChatMessage[]>): ChatMessage[] {
  const byId = new Map<string, ChatMessage>();
  Object.values(sessionMessages).forEach((messages) => {
    messages.forEach((message) => {
      byId.set(`${message.sessionId}:${message.id}`, message);
    });
  });
  return [...byId.values()];
}

export function buildTurnIdentity(
  turn: AgentTurn,
  sessionById: Map<string, ChatSession>,
  personaById: Map<string, Persona>,
): { subtitle: string; detail?: string; actorLabel: string | null; modelLabel: string | null } {
  const session = sessionById.get(turn.sessionId) ?? null;
  const persona = session ? personaById.get(session.personaId) ?? null : null;
  const actorLabel = turn.agentRun?.label ?? persona?.name ?? session?.personaId ?? null;
  const modelLabel = persona?.model ?? null;

  if (actorLabel && modelLabel) {
    return {
      subtitle: `${actorLabel} - ${modelLabel}`,
      detail: turn.done ? 'Turn completed' : 'Turn in progress',
      actorLabel,
      modelLabel,
    };
  }

  if (actorLabel) {
    return {
      subtitle: actorLabel,
      detail: turn.done ? 'Turn completed' : 'Turn in progress',
      actorLabel,
      modelLabel,
    };
  }

  return {
    subtitle: turn.done ? 'Turn completed' : 'Turn in progress',
    actorLabel,
    modelLabel,
  };
}

export function buildToolCycleLabel(toolCount: number): string {
  if (toolCount === 0) return 'No tools in cycle';
  return `${toolCount} tool${toolCount === 1 ? '' : 's'} in cycle`;
}

export function buildCopiedFileArtifact(file: SubagentCopiedFile): ExecutionGraphArtifact {
  const path = typeof file.toPath === 'string' && file.toPath.trim().length > 0
    ? file.toPath
    : typeof file.fromPath === 'string' && file.fromPath.trim().length > 0
      ? file.fromPath
      : 'copied-file';
  return {
    id: `artifact:${path}`,
    kind: 'file',
    label: basename(path),
    subtitle: path,
    path,
    preview: `${file.sizeBytes} bytes copied`,
    payload: file,
  };
}
