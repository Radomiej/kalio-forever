import type { ExecutionProfile, LLMConfig, LLMStructuredOutputRequest, ToolMeta, ToolResult } from '@kalio/types';
import type { InternalLLMChunk } from './llm-chunk.types';
import type { ContextManagedLLMMessage } from '../../../common/utils/context-managed-llm-message.util';

export interface LLMSourceParams {
  messages: ContextManagedLLMMessage[];
  tools: ToolMeta[];
  sessionId: string;
  messageId: string;
  model?: string;
  /** Provider-owned tools explicitly enabled for this persona/runtime. */
  providerToolNames?: string[];
  abortSignal?: AbortSignal;
  structuredOutput?: LLMStructuredOutputRequest;
  executionProfile?: ExecutionProfile;
  runId?: string;
  externalThreadId?: string;
  cwd?: string;
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
  toolResultChannel?: LLMToolResultChannel;
}

export interface LLMToolResultChannel {
  setHandler(handler: (callId: string, result: ToolResult) => Promise<void> | void): void;
}

/**
 * Abstraction over the LLM provider for the chat module.
 * Returns an async iterable of InternalLLMChunks ending with a DoneChunk.
 *
 * Adapters (e.g. LLMServiceAdapter) bridge from the callback-based LLMService
 * to this interface. Not part of @kalio/types — internal to the chat module.
 */
export interface ILLMSource {
  stream(params: LLMSourceParams): AsyncIterable<InternalLLMChunk>;
  getConfig?(): Promise<LLMConfig & { source: 'db' | 'env' }>;
}
