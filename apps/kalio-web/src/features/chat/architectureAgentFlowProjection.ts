import type { ArchitectureRun, ChatMessage } from '@kalio/types';
import { apiClient } from '../../services/apiClient';
import type { AgentTurn } from '../../store/sessionStore';
import { getArchitectureRunResult } from '../architect/architect.api';
import type { ArchitectRunResult } from '../architect/architect.types';
import { buildArchitectureRunTurnProjection } from './architectureChatSummary';
import { resolveArchitectureRunTurnUpdate } from './architectureTurnProjection';
import { extractSubAgentFlowResult } from './subAgentFlowResult.parser';

interface ProjectSubAgentFlowArchitectureResultOptions {
  toolName?: string | null;
  resultData: unknown;
  resultSessionId?: string | null;
  toolResultMessageId?: string | null;
  fetchArchitectureRun?: (runId: string) => Promise<ArchitectRunResult>;
  getSessionMessages: (sessionId: string) => ChatMessage[];
  getSessionAgentTurns: (sessionId: string) => AgentTurn[];
  getSessionActiveTurnId: (sessionId: string) => string | null;
  setMessages: (messages: ChatMessage[], sessionId?: string | null) => void;
  setAgentTurns: (turns: AgentTurn[], sessionId?: string | null) => void;
}

export async function fetchArchitectureRunResultById(runId: string): Promise<ArchitectRunResult> {
  const { data: run } = await apiClient.get<ArchitectureRun>(`/api/architecture-runs/${runId}`);
  return getArchitectureRunResult(run);
}

export async function projectSubAgentFlowArchitectureResult({
  toolName,
  resultData,
  resultSessionId,
  toolResultMessageId,
  fetchArchitectureRun = fetchArchitectureRunResultById,
  getSessionMessages,
  getSessionAgentTurns,
  getSessionActiveTurnId,
  setMessages,
  setAgentTurns,
}: ProjectSubAgentFlowArchitectureResultOptions): Promise<boolean> {
  if (toolName !== 'run_sub_agentflow' || !resultSessionId) {
    return false;
  }

  const subAgentFlowResult = extractSubAgentFlowResult(resultData);
  const runId = subAgentFlowResult?.openGraphRunId;
  if (!runId) {
    return false;
  }

  const currentMessages = getSessionMessages(resultSessionId);
  const promptMessageId = promptMessageIdForCurrentTurn({
    turns: getSessionAgentTurns(resultSessionId),
    activeTurnId: getSessionActiveTurnId(resultSessionId),
    messages: currentMessages,
  });
  if (!promptMessageId) {
    return false;
  }

  const result = await fetchArchitectureRun(runId);
  const projection = buildArchitectureRunTurnProjection(result, resultSessionId);
  const resolved = resolveArchitectureRunTurnUpdate({
    currentMessages,
    currentTurns: getSessionAgentTurns(resultSessionId),
    pendingAssistantMessageId: toolResultMessageId ?? '',
    promptMessageId,
    projection,
    result,
    sessionId: resultSessionId,
  });

  setMessages(resolved.messages, resultSessionId);
  setAgentTurns(resolved.turns, resultSessionId);
  return true;
}

function promptMessageIdForCurrentTurn({
  turns,
  activeTurnId,
  messages,
}: {
  turns: AgentTurn[];
  activeTurnId: string | null;
  messages: ChatMessage[];
}): string | null {
  const activeTurn = activeTurnId
    ? turns.find((turn) => turn.id === activeTurnId)
    : null;
  if (activeTurn?.promptMessageId) {
    return activeTurn.promptMessageId;
  }

  const runSubAgentFlowTurn = [...turns]
    .reverse()
    .find((turn) => turn.items.some((item) => item.kind === 'tool'));
  if (runSubAgentFlowTurn?.promptMessageId) {
    return runSubAgentFlowTurn.promptMessageId;
  }

  return [...messages]
    .reverse()
    .find((message) => message.role === 'user')
    ?.id ?? null;
}
