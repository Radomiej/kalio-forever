import type { ChatMessage, ChatSession } from '@kalio/types';
import { findArchitectureRunInMessages } from './architectureChatSummary';

export function architectureSessionLabel(session: ChatSession): string | null {
  const architectureContext = session.runtimeContext?.architectureContext;
  if (!architectureContext || typeof architectureContext !== 'object') {
    return null;
  }
  const displayLabel = architectureContext['displayLabel'];
  if (typeof displayLabel === 'string' && displayLabel.trim().length > 0) {
    return displayLabel.trim();
  }
  const schemaName = architectureContext['schemaName'];
  return typeof schemaName === 'string' && schemaName.trim().length > 0 ? schemaName.trim() : null;
}

function humanizeArchitectureSchemaId(schemaId: string): string {
  return schemaId
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`)
    .join(' ');
}

function architectureMessageLabel(messages: ChatMessage[]): string | null {
  const summary = findArchitectureRunInMessages(messages);
  if (!summary) {
    return null;
  }

  for (const message of [...messages].reverse()) {
    if (message.role !== 'assistant' || !message.toolCalls?.length) {
      continue;
    }

    const matchingCall = message.toolCalls.find((toolCall) => (
      toolCall.name === 'run_subagent'
      && toolCall.args['architectureRunId'] === summary.runId
      && typeof toolCall.args['schemaName'] === 'string'
      && toolCall.args['schemaName'].trim().length > 0
    ));

    if (matchingCall && typeof matchingCall.args['schemaName'] === 'string') {
      return matchingCall.args['schemaName'].trim();
    }
  }

  return summary.schemaId.trim().length > 0
    ? humanizeArchitectureSchemaId(summary.schemaId)
    : null;
}

export function resolveArchitectureLabel(session: ChatSession, messages: ChatMessage[]): string | null {
  return architectureSessionLabel(session) ?? architectureMessageLabel(messages);
}
