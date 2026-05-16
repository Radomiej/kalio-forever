import type { AgentRunContext, SocketEvents, SubagentCopiedFile, ToolMeta, VFSMode } from '@kalio/types';

export const SUBAGENT_RUNTIME = Symbol('SUBAGENT_RUNTIME');

export type SubagentEmit = <K extends keyof SocketEvents>(event: K, data: SocketEvents[K]) => void;

export interface RunSubagentRequest {
  parentSessionId: string;
  parentToolCallId: string;
  objective: string;
  attachments?: string[];
  autoApproveTools?: string[];
  childSessionId?: string;
  personaId?: string;
  availableTools: ToolMeta[];
  timeoutMs: number;
  maxIterations?: number;
  vfsMode: VFSMode;
  copyOutputs: boolean;
  copyTargetPrefix?: string;
  emit?: SubagentEmit;
  parentAgentRun?: AgentRunContext;
}

export interface RunSubagentResult {
  result: string;
  taskId: string;
  childSessionId: string;
  parentSessionId: string;
  vfsMode: VFSMode;
  vfsSessionId: string;
  copiedFiles: SubagentCopiedFile[];
  durationMs: number;
}

export interface SubagentRuntimePort {
  runSubagent(request: RunSubagentRequest): Promise<RunSubagentResult>;
}
