import type { ArchitectureChatProjection, ArchitectureExecutionEvent } from '@kalio/types';

import { architectureActionFieldsForEvent } from './architecture-action-summary';

type ArchitectureChatMessage = ArchitectureChatProjection['messages'][number];

export function buildArchitectureRuntimeChatProjection(
  runId: string,
  events: ArchitectureExecutionEvent[],
): ArchitectureChatProjection {
  return {
    runId,
    messages: events
      .filter(isRuntimeChatProjectionEvent)
      .map(toRuntimeChatMessage),
  };
}

function toRuntimeChatMessage(event: ArchitectureExecutionEvent): ArchitectureChatMessage {
  const actionFields = architectureActionFieldsForEvent(event);
  return {
    id: `${event.id}:message`,
    eventId: event.id,
    speaker: speakerForRuntimeChatEvent(event),
    content: event.message,
    actionSummary: actionFields.actionSummary,
    action: actionFields.action,
    detail: actionFields.detail,
    roleSlotId: event.roleSlotId,
    route: event.route,
    incompleteReason: incompleteReasonFromRuntimeChatEvent(event),
    createdAt: event.createdAt,
  };
}

function speakerForRuntimeChatEvent(event: ArchitectureExecutionEvent): ArchitectureChatMessage['speaker'] {
  if (event.type === 'run_created') return 'system';
  if (event.type === 'run_stopped') return 'system';
  if (event.type === 'router_decision') return 'router';
  if (event.type === 'router_output') return 'router';
  if (event.type === 'final_artifact') return 'finalizer';
  if (event.type === 'artifact_created') return 'finalizer';
  return 'participant';
}

function isRuntimeChatProjectionEvent(event: ArchitectureExecutionEvent): boolean {
  return event.type === 'run_created'
    || event.type === 'run_stopped'
    || event.type === 'participant_output'
    || event.type === 'router_decision'
    || event.type === 'final_artifact';
}

function incompleteReasonFromRuntimeChatEvent(event: ArchitectureExecutionEvent): string | undefined {
  const reason = event.data?.['incompleteReason'];
  return typeof reason === 'string' && reason.trim().length > 0 ? reason : undefined;
}
