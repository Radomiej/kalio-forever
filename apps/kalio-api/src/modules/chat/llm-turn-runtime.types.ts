import type { AgentRunContext, ExecutionProfile, LLMContent, LLMStructuredOutputRequest, SessionRuntimeKind, ToolMeta } from '@kalio/types';
import type { EmitFn } from './interfaces/stream-context.interface';

export type LLMRuntimeKind = Extract<SessionRuntimeKind, 'chat' | 'subagent' | 'agent-flow-branch'>;

export interface LLMAgentLoopResumeState {
  iteration: number;
  currentLimit: number;
}

export interface LLMAgentLoopCallbacks {
  onBeforeIteration?: (iteration: number, messageId: string, currentLimit: number) => Promise<void>;
  onToolPending?: () => Promise<void>;
  onWaitingForHuman?: () => Promise<void>;
  onToolRunning?: () => Promise<void>;
  onEscalation?: (message: string) => void;
  onIterationLimitReached?: (state: { iterationCount: number; currentLimit: number }) => Promise<number | null>;
}

export interface LLMAgentLoopRequest {
  runtimeKind: LLMRuntimeKind;
  sessionId: string;
  runId?: string;
  historySessionId?: string;
  turnId?: string;
  promptMessageId?: string;
  personaId: string;
  effectiveSystemPrompt: string;
  toolMetas: ToolMeta[];
  model?: string;
  providerToolNames?: string[];
  executionProfile?: ExecutionProfile;
  externalThreadId?: string;
  cwd?: string;
  providerCompletesTurn?: boolean;
  onExternalThreadBound?: (threadId: string, binding?: { turnId?: string; processEpoch?: string }) => Promise<void>;
  onExternalRuntimeLost?: (event: {
    authProfileId: string;
    processEpoch: string;
    reason: 'reset' | 'exit' | 'error' | 'closed';
  }) => void;
  onNativeApprovalRequested?: (request: {
    method: string;
    params: Record<string, unknown>;
  }) => Promise<'accept' | 'decline' | 'cancel'>;
  onExternalAudit?: (event: {
    eventName: string;
    status?: 'started' | 'running' | 'completed' | 'waiting_for_human' | 'failed' | 'cancelled';
    data?: Record<string, unknown>;
  }) => Promise<void> | void;
  onToolResult?: (callId: string, result: import('@kalio/types').ToolResult) => Promise<void>;
  vfsSessionId?: string;
  agentRun?: AgentRunContext;
  abortSignal: AbortSignal;
  emit: EmitFn;
  maxIterations: number;
  resumeState?: LLMAgentLoopResumeState;
  maxEmptyNoToolRetries?: number;
  rawXmlToolNames?: string[];
  structuredOutput?: LLMStructuredOutputRequest;
  auditMetadata?: Record<string, unknown>;
  auditDomain?: 'chat' | 'subagent';
  firstMessageId?: string;
  messageIdPrefix?: string;
  callbacks?: LLMAgentLoopCallbacks;
  transformToolCall?: (toolCall: { id: string; name: string; args: Record<string, unknown> }) =>
    { id: string; name: string; args: Record<string, unknown> };
}

export interface LLMAgentLoopResult {
  lastMessageId: string;
  finalText: string;
  structuredOutput?: unknown;
  iterationCount: number;
  finalLimit: number;
  exhausted: boolean;
  aborted: boolean;
  emptyNoToolRetriesExhausted: boolean;
  maxIterationsReached: boolean;
}

export type LLMUsage = { promptTokens: number; completionTokens: number; totalTokens?: number };

export function estimateTextTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function estimateContentTokens(content: LLMContent): number {
  if (typeof content === 'string') {
    return estimateTextTokens(content);
  }
  return content.reduce((total, part) => {
    if (part.type === 'text') {
      return total + estimateTextTokens(part.text);
    }
    return total + 1024;
  }, 0);
}
