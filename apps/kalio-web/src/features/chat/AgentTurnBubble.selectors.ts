import type { ChatMessage } from '@kalio/types';
import type { ToolActivity } from '../../store/agentStore';
import type { AgentTurn, AgentTurnItem } from '../../store/sessionStore';

export interface AgentTurnBubblePropsLike {
  turn: AgentTurn;
  toolActivities: ToolActivity[];
  answeredCallIds?: Set<string>;
  renderedMessages?: ChatMessage[];
}

export function collectTurnMessageIds(items: AgentTurnItem[]): string[] {
  return [...new Set(
    items
      .filter((item): item is Extract<AgentTurnItem, { messageId: string }> => item.kind !== 'tool')
      .map((item) => item.messageId),
  )];
}

export function collectTurnCallIds(items: AgentTurnItem[]): string[] {
  return items
    .filter((item): item is Extract<AgentTurnItem, { callId: string }> => item.kind === 'tool')
    .map((item) => item.callId);
}

export function pickChunkSubset(
  source: Readonly<Record<string, string>>,
  messageIds: readonly string[],
): Record<string, string> {
  const subset: Record<string, string> = {};
  messageIds.forEach((messageId) => {
    const value = source[messageId];
    if (value !== undefined) {
      subset[messageId] = value;
    }
  });
  return subset;
}

export function pickSessionMessagesSubset(
  source: Readonly<Record<string, ChatMessage[]>>,
  sessionIds: readonly string[],
): Record<string, ChatMessage[]> {
  const subset: Record<string, ChatMessage[]> = {};
  sessionIds.forEach((sessionId) => {
    const messages = source[sessionId];
    if (messages) {
      subset[sessionId] = messages;
    }
  });
  return subset;
}

export function pickRelevantTurnMessages(
  messages: readonly ChatMessage[],
  turn: AgentTurn,
): ChatMessage[] {
  const messageIds = new Set(collectTurnMessageIds(turn.items));
  const callIds = new Set(collectTurnCallIds(turn.items));

  return messages.filter((message) => {
    if (messageIds.has(message.id)) {
      return true;
    }
    if (message.role === 'tool_result' && message.toolCallId && callIds.has(message.toolCallId)) {
      return true;
    }
    if (message.role === 'assistant' && message.toolCalls) {
      return message.toolCalls.some((toolCall) => callIds.has(toolCall.id));
    }
    return false;
  });
}

function messageRefById(messages: readonly ChatMessage[] | undefined): Map<string, ChatMessage> {
  return new Map((messages ?? []).map((message) => [message.id, message] as const));
}

function toolActivityRefByCallId(activities: readonly ToolActivity[]): Map<string, ToolActivity> {
  return new Map(activities.map((activity) => [activity.callId, activity] as const));
}

function areRelevantMessagesStable(
  prevMessages: readonly ChatMessage[] | undefined,
  nextMessages: readonly ChatMessage[] | undefined,
  messageIds: readonly string[],
): boolean {
  const prevById = messageRefById(prevMessages);
  const nextById = messageRefById(nextMessages);
  return messageIds.every((messageId) => prevById.get(messageId) === nextById.get(messageId));
}

function areRelevantToolActivitiesStable(
  prevActivities: readonly ToolActivity[],
  nextActivities: readonly ToolActivity[],
  callIds: readonly string[],
): boolean {
  const prevByCallId = toolActivityRefByCallId(prevActivities);
  const nextByCallId = toolActivityRefByCallId(nextActivities);
  return callIds.every((callId) => prevByCallId.get(callId) === nextByCallId.get(callId));
}

function areRelevantAnsweredCallIdsStable(
  prevAnsweredCallIds: ReadonlySet<string> | undefined,
  nextAnsweredCallIds: ReadonlySet<string> | undefined,
  callIds: readonly string[],
): boolean {
  return callIds.every((callId) => (
    Boolean(prevAnsweredCallIds?.has(callId)) === Boolean(nextAnsweredCallIds?.has(callId))
  ));
}

export function areAgentTurnBubblePropsEqual(
  prevProps: Readonly<AgentTurnBubblePropsLike>,
  nextProps: Readonly<AgentTurnBubblePropsLike>,
): boolean {
  if (prevProps.turn !== nextProps.turn) {
    return false;
  }

  const messageIds = collectTurnMessageIds(nextProps.turn.items);
  if (!areRelevantMessagesStable(prevProps.renderedMessages, nextProps.renderedMessages, messageIds)) {
    return false;
  }

  const callIds = collectTurnCallIds(nextProps.turn.items);
  if (!areRelevantToolActivitiesStable(prevProps.toolActivities, nextProps.toolActivities, callIds)) {
    return false;
  }

  return areRelevantAnsweredCallIdsStable(prevProps.answeredCallIds, nextProps.answeredCallIds, callIds);
}
