import type { AgentRunContext, ID } from './index';

export interface ToolConfirmationRequest {
  requestId: string;
  toolCallId: string;
  sessionId: ID;
  turnId?: ID;
  promptMessageId?: ID;
  toolName: string;
  args: Record<string, unknown>;
  /** Milliseconds; zero keeps the human wait indefinite. */
  timeoutMs: number;
  agentRun?: AgentRunContext;
  /** Bounded supervisor assessment, never a human response or execution authority. */
  policyReason?: string;
}
