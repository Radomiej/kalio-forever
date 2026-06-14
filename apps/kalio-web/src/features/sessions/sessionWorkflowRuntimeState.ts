import type { ChatMessage } from '@kalio/types';
import type { AgentTurn } from '../../store/sessionStore';
import { findArchitectureRunInMessages } from '../chat/architectureChatSummary';
import type { SessionRuntimeState } from './sessionTreeDisplay';

export function workflowEnvelopeRuntimeStateForSession(
  messages: ChatMessage[],
  turns: AgentTurn[],
): SessionRuntimeState | null {
  const run = findArchitectureRunInMessages(messages);
  if (run?.hostProjectionKind === 'workflow-envelope') {
    return runtimeStateFromArchitectureRunStatus(run.status);
  }

  const lastTurn = turns.at(-1);
  if (lastTurn?.turnKind === 'workflow-envelope' && !lastTurn.done) {
    return 'running';
  }

  return null;
}

function runtimeStateFromArchitectureRunStatus(
  status: NonNullable<ChatMessage['architectureRun']>['status'],
): SessionRuntimeState {
  if (status === 'queued') {
    return 'pending';
  }
  if (status === 'running') {
    return 'running';
  }
  if (status === 'completed') {
    return 'done';
  }
  if (status === 'cancelled') {
    return 'stopped';
  }
  return 'error';
}
