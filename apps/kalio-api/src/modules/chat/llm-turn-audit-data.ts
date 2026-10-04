import type { LLMContent } from '@kalio/types';
import { estimateContentTokens, type LLMAgentLoopRequest } from './llm-turn-runtime.types';

export function buildAuditRequestData(request: LLMAgentLoopRequest, auditDomain: 'chat' | 'subagent', iteration: number,
  history: Array<{ content: LLMContent }>): Record<string, unknown> {
  const common = {
    iteration, estimatedInputTokens: history.reduce((total, item) => total + estimateContentTokens(item.content), 0),
    messageCount: history.length, toolCount: request.toolMetas.length, ...(request.auditMetadata ?? {}),
  };
  if (auditDomain === 'subagent' && request.agentRun) return {
    domain: 'subagent', kind: 'subagent_llm_request', childAgentRunId: request.agentRun.agentRunId,
    parentSessionId: request.agentRun.parentSessionId, parentToolCallId: request.agentRun.parentToolCallId, ...common,
  };
  return { personaId: request.personaId, ...common };
}

export function buildAuditResponseData(request: LLMAgentLoopRequest, auditDomain: 'chat' | 'subagent', iteration: number): Record<string, unknown> {
  const common = { iteration, textLength: 0, thinkingLength: 0, toolCallCount: 0, ...(request.auditMetadata ?? {}) };
  if (auditDomain === 'subagent' && request.agentRun) return {
    domain: 'subagent', kind: 'subagent_llm_response', childAgentRunId: request.agentRun.agentRunId,
    parentSessionId: request.agentRun.parentSessionId, parentToolCallId: request.agentRun.parentToolCallId, ...common,
  };
  return common;
}
