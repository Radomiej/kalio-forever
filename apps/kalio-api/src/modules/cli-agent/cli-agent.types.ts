import type { SocketEvents } from '@kalio/types';

export type ProgressEmitFn = (event: 'cli_agent:progress', data: SocketEvents['cli_agent:progress']) => void;

export interface CLIAgentRunLimits {
  inactivityTimeoutMs: number;
  hardTimeoutMs?: number;
}

/** Options for executing a CLI agent task. */
export interface RunCliAgentRequest {
  /** One of: 'copilot' | 'gemini' | 'claude' | 'codex' */
  agentId: string;
  /** Task description sent to the CLI agent. */
  prompt: string;
  /** Working directory — must be validated by caller before passing. */
  workdir: string;
  /** Tool call ID used for progress event correlation. */
  callId: string;
  /** Chat session — included in progress events. */
  sessionId: string;
  /** Optional: called with 'cli_agent:progress' for each stdout/stderr chunk. */
  emitFn?: ProgressEmitFn;
  /** Optional inactivity timeout override in ms. */
  inactivityTimeoutMs?: number;
  /** Deprecated tool-level alias for inactivityTimeoutMs while XML/tool callers migrate. */
  timeoutMs?: number;
  /** Optional hard wall-clock timeout in ms. When omitted, hard timeout is disabled unless config enables it. */
  hardTimeoutMs?: number;
  /** Optional model override for adapters that support model selection. */
  model?: string;
  /** Optional abort signal from the originating tool/chat turn. */
  abortSignal?: AbortSignal;
}
