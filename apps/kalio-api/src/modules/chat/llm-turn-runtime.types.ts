import type { AgentRunContext, LLMContent, SessionRuntimeKind, ToolMeta } from '@kalio/types';
import type { EmitFn } from './interfaces/stream-context.interface';

export type LLMRuntimeKind = Extract<SessionRuntimeKind, 'chat' | 'subagent' | 'agent-flow-branch'>;

export interface LLMAgentLoopCallbacks {
  onBeforeIteration?: (iteration: number, messageId: string) => Promise<void>;
  onToolPending?: () => Promise<void>;
  onToolRunning?: () => Promise<void>;
  onEscalation?: (message: string) => void;
  onIterationLimitReached?: (state: { iterationCount: number; currentLimit: number }) => Promise<number | null>;
}

export interface LLMAgentLoopRequest {
  runtimeKind: LLMRuntimeKind;
  sessionId: string;
  historySessionId?: string;
  turnId?: string;
  promptMessageId?: string;
  personaId: string;
  effectiveSystemPrompt: string;
  toolMetas: ToolMeta[];
  model?: string;
  vfsSessionId?: string;
  agentRun?: AgentRunContext;
  abortSignal: AbortSignal;
  emit: EmitFn;
  maxIterations: number;
  maxEmptyNoToolRetries?: number;
  rawXmlToolNames?: string[];
  auditMetadata?: Record<string, unknown>;
  auditDomain?: 'chat' | 'subagent';
  firstMessageId?: string;
  messageIdPrefix?: string;
  callbacks?: LLMAgentLoopCallbacks;
}

export interface LLMAgentLoopResult {
  lastMessageId: string;
  finalText: string;
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
