import type { SocketEvents } from '@kalio/types';

export type ProgressEmitFn = (event: 'cli_agent:progress', data: SocketEvents['cli_agent:progress']) => void;

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
  /** Optional timeout override in ms; capped at MAX_TIMEOUT_MS inside the service. */
  timeoutMs?: number;
}
