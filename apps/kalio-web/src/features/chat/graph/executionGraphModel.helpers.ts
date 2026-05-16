import type { ChatMessage, SubagentToolResult } from '@kalio/types';
import type { ToolActivity } from '../../../store/agentStore';
import type { AgentTurn } from '../../../store/sessionStore';

export const NODE_WIDTH = 220;
export const NODE_HEIGHT = 132;
export const COLUMN_GAP = 68;
export const ROW_GAP = 40;
export const BOARD_PADDING_X = 28;
export const BOARD_PADDING_Y = 28;

export type ExecutionGraphNodeStatus = 'idle' | 'running' | 'success' | 'error';
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

export function statusFromActivity(activity: ToolActivity | null, hasResult: boolean): ExecutionGraphNodeStatus {
  if (activity?.status === 'error' || activity?.status === 'cancelled' || activity?.status === 'expired') {
    return 'error';
  }
  if (activity?.status === 'running' || activity?.status === 'awaiting_confirmation') {
    return 'running';
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
    snapshots.set(message.toolCallId, {
      callId: message.toolCallId,
      toolName: existing?.toolName ?? 'tool',
      args: existing?.args ?? {},
      activity: existing?.activity ?? null,
      result: safeParse(message.content),
    });
  });

  return snapshots;
}

export function positionFor(column: number, row: number): { x: number; y: number } {
  return {
    x: BOARD_PADDING_X + column * (NODE_WIDTH + COLUMN_GAP),
    y: BOARD_PADDING_Y + row * (NODE_HEIGHT + ROW_GAP),
  };
}

export function getFinalAnswerMessage(turn: AgentTurn, messageById: Map<string, ChatMessage>): ChatMessage | null {
  const textMessageIds = turn.items
    .filter((item): item is Extract<AgentTurn['items'][number], { kind: 'text' }> => item.kind === 'text')
    .map((item) => item.messageId);

  const candidates = textMessageIds
    .map((messageId) => messageById.get(messageId) ?? null)
    .filter((message): message is ChatMessage => message !== null && message.content.trim().length > 0);

  return candidates.at(-1) ?? null;
}

export function getTurnStatus(turn: AgentTurn, toolSnapshots: Map<string, ToolSnapshot>): ExecutionGraphNodeStatus {
  if (turn.error) return 'error';
  if (!turn.done) return 'running';

  const toolStatuses = turn.items
    .filter((item): item is Extract<AgentTurn['items'][number], { kind: 'tool' }> => item.kind === 'tool')
    .map((item) => {
      const snapshot = toolSnapshots.get(item.callId);
      return statusFromActivity(snapshot?.activity ?? null, snapshot?.result != null);
    });

  if (toolStatuses.includes('error')) return 'error';
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
  return actorLabel ? `${actorLabel} · ${toolLabel}` : toolLabel;
}
