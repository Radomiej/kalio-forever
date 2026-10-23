import type { ChatMessage } from '@kalio/types';
import type { ToolActivity } from '../../store/agentStore';
import { AgentTurnBubble } from './AgentTurnBubble';
import { MessageBubble } from './MessageBubble';
import type { ChatTimelineEntry } from './chatUtils';
import { ConfirmationInlineBubble } from './ToolCallBubble.Chrome';

interface ConversationTimelineProps {
  entries: ChatTimelineEntry[];
  toolActivities: ToolActivity[];
  answeredCallIds: Set<string>;
  renderedMessages: ChatMessage[];
}

function getTimelineToolCallIds(entries: ChatTimelineEntry[]): Set<string> {
  const callIds = new Set<string>();
  entries.forEach((entry) => {
    if (entry.kind !== 'agent_turn') return;
    entry.turn.items.forEach((item) => {
      if (item.kind === 'tool') callIds.add(item.callId);
    });
  });
  return callIds;
}

export function ConversationTimeline({
  entries,
  toolActivities,
  answeredCallIds,
  renderedMessages,
}: ConversationTimelineProps) {
  const timelineToolCallIds = getTimelineToolCallIds(entries);
  const renderedOrphanCallIds = new Set<string>();
  const orphanConfirmations = toolActivities.filter((activity) => {
    if (
      activity.status !== 'awaiting_confirmation'
      || timelineToolCallIds.has(activity.callId)
      || renderedOrphanCallIds.has(activity.callId)
    ) {
      return false;
    }
    renderedOrphanCallIds.add(activity.callId);
    return true;
  });

  return (
    <>
      {entries.map((entry) => (
        entry.kind === 'user_message'
          ? <MessageBubble key={entry.message.id} message={entry.message} />
          : (
            <AgentTurnBubble
              key={entry.turn.id}
              turn={entry.turn}
              toolActivities={toolActivities}
              answeredCallIds={answeredCallIds}
              renderedMessages={renderedMessages}
            />
          )
      ))}
      {orphanConfirmations.map((activity) => (
        <ConfirmationInlineBubble key={activity.callId} activity={activity} />
      ))}
    </>
  );
}
