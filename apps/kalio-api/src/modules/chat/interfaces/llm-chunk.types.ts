/**
 * Internal discriminated union for LLM stream chunks.
 * These are local to the chat module — not BE↔FE contracts.
 * Never add these to @kalio/types.
 */

export interface TextDeltaChunk {
  type: 'text_delta';
  delta: string;
}

export interface ThinkingDeltaChunk {
  type: 'thinking_delta';
  delta: string;
}

export interface ToolCallChunk {
  type: 'tool_call';
  callId: string;
  name: string;
  args: Record<string, unknown>;
}

/** Synthetic terminal chunk yielded by ILLMSource after stream ends */
export interface DoneChunk {
  type: 'done';
}

/** Progress update while LLM is streaming tool call arguments (before tool:start fires) */
export interface ToolArgProgressChunk {
  type: 'tool_arg_progress';
  toolName: string;
  totalChars: number;
  charsPerSec: number;
}

/** Provider-reported request usage, when available from the backend API. */
export interface UsageChunk {
  type: 'usage';
  promptTokens: number;
  completionTokens: number;
  totalTokens?: number;
}

/** Provider-native structured output parsed from a schema-bound response. */
export interface StructuredOutputChunk {
  type: 'structured_output';
  value: unknown;
}

export type InternalLLMChunk =
  | TextDeltaChunk
  | ThinkingDeltaChunk
  | ToolCallChunk
  | DoneChunk
  | ToolArgProgressChunk
  | UsageChunk
  | StructuredOutputChunk;
