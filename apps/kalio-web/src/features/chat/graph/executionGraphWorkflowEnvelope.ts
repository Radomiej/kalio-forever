import type { ChatMessage } from '@kalio/types';
import type { AgentTurn } from '../../../store/sessionStore';
import { resolveWorkflowTurnProjection } from '../workflowTurnProjection';

export function findWorkflowEnvelopeArchitectureMessage(
  turn: AgentTurn,
  messages: ChatMessage[],
  toolArgsByCallId: ReadonlyMap<string, Record<string, unknown>>,
  finalMessage: ChatMessage | null,
): ChatMessage | null {
  const projection = resolveWorkflowTurnProjection(turn, messages, toolArgsByCallId);
  if (
    finalMessage?.architectureRun
    && (!projection.architectureRunId || finalMessage.architectureRun.runId === projection.architectureRunId)
  ) {
    return finalMessage;
  }
  return projection.persistedArchitectureMessage;
}
