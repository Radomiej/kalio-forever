import type {
  AgentRunContext,
  ArchitectureSlotToolPolicy,
  LLMStructuredOutputRequest,
  SocketEvents,
  SubagentCopiedFile,
  ToolMeta,
  VFSMode,
  WorkflowErrorCode,
  WorkflowFailure,
  WorkflowReasonCode,
} from '@kalio/types';

export const SUBAGENT_RUNTIME = Symbol('SUBAGENT_RUNTIME');

export type SubagentEmit = <K extends keyof SocketEvents>(event: K, data: SocketEvents[K]) => void;

export interface RunSubagentRequest {
  parentSessionId: string;
  parentTurnId?: string;
  parentPromptMessageId?: string;
  parentToolCallId: string;
  objective: string;
  attachments?: string[];
  auditContext?: Record<string, unknown>;
  autoApproveTools?: string[];
  childSessionId?: string;
  resumeTurnId?: string;
  personaId?: string;
  model?: string;
  availableTools?: ToolMeta[];
  slotPolicy?: ArchitectureSlotToolPolicy;
  architectureContext?: Record<string, unknown>;
  timeoutMs: number;
  maxIterations?: number;
  vfsMode: VFSMode;
  copyOutputs: boolean;
  copyTargetPrefix?: string;
  emit?: SubagentEmit;
  parentAgentRun?: AgentRunContext;
  structuredOutput?: LLMStructuredOutputRequest;
}

export interface RunSubagentResult {
  result: string;
  structuredOutput?: unknown;
  taskId: string;
  childSessionId: string;
  parentSessionId: string;
  status?: 'completed' | 'failed' | 'cancelled';
  reasonCode?: WorkflowReasonCode;
  errorCode?: WorkflowErrorCode;
  failure?: WorkflowFailure;
  vfsMode: VFSMode;
  vfsSessionId: string;
  copiedFiles: SubagentCopiedFile[];
  durationMs: number;
}

export interface ActiveSubagentRunStatus {
  sessionId: string;
  parentSessionId: string;
  turnId: string;
  promptMessageId?: string;
  agentRun?: AgentRunContext;
}

export interface SubagentRuntimePort {
  runSubagent(request: RunSubagentRequest): Promise<RunSubagentResult>;
  getActiveRunStatus?(sessionId: string): ActiveSubagentRunStatus | null;
  stopAndDrainSessions?(sessionIds: readonly string[]): Promise<void>;
}
