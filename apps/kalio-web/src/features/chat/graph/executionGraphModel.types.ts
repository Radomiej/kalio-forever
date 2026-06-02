import type {
  ArchitectureChatRunSummary,
  ChatMessage,
  ChatSession,
  ChildExecutionKind,
  CLIAgentSessionSnapshot,
  Persona,
  SubAgentFlowResult,
  SubagentCopiedFile,
  SubagentToolResult,
} from '@kalio/types';
import type { ToolActivity } from '../../../store/agentStore';
import type { AgentTurn } from '../../../store/sessionStore';
import type { ExecutionGraphArtifact, ExecutionGraphNodeStatus } from './executionGraphModel.helpers';

export type ExecutionGraphNodeKind =
  | 'prompt'
  | 'turn'
  | 'tool-group'
  | 'tool'
  | 'subagent'
  | 'cli-agent'
  | 'agent-flow'
  | 'architecture-run'
  | 'tool-result'
  | 'artifact'
  | 'final-answer';

type PromptPayload = {
  kind: 'prompt';
  message: ChatMessage;
};

type TurnPayload = {
  kind: 'turn';
  turn: AgentTurn;
  textPreview: string | null;
  toolCount: number;
  thinkingCount: number;
  thinkingPreviews: string[];
  actorLabel: string | null;
  modelLabel: string | null;
};

type ToolPayload = {
  kind: 'tool';
  toolName: string;
  args: Record<string, unknown>;
  activity: ToolActivity | null;
  result: unknown;
  confirmationRequired: boolean;
};

type ToolGroupPayload = {
  kind: 'tool-group';
  tools: Array<{
    callId: string;
    toolName: string;
    args: Record<string, unknown>;
    status: ExecutionGraphNodeStatus;
    result: unknown;
    confirmationRequired: boolean;
  }>;
};

type SubagentPayload = {
  kind: 'subagent';
  childExecutionKind: Extract<ChildExecutionKind, 'sub_agent'>;
  result: SubagentToolResult;
  transcript: ChatMessage[];
  copiedFiles: SubagentCopiedFile[];
  actorLabel: string | null;
  modelLabel: string | null;
  inputPrompt: string | null;
};

type CliAgentPayload = {
  kind: 'cli-agent';
  childExecutionKind: Extract<ChildExecutionKind, 'cli_agent'>;
  snapshot: CLIAgentSessionSnapshot;
  transcript: ChatMessage[];
  inputPrompt: string | null;
};

type ArchitectureRunPayload = {
  kind: 'architecture-run';
  summary: ArchitectureChatRunSummary;
  route?: {
    source: string;
    fromNodeId: string;
    toNodeId: string;
    eventId: string;
    streamStatus?: string;
    chunkCount?: number;
    branchSessionId?: string;
    contentPreview?: string;
    incompleteReason?: string;
    toolEvidence?: {
      toolCallCount: number;
      toolResultCount: number;
      toolNames: string[];
      successfulToolNames: string[];
    };
  };
};

type AgentFlowPayload = {
  kind: 'agent-flow';
  childExecutionKind: Extract<ChildExecutionKind, 'sub_agentflow'>;
  result: SubAgentFlowResult;
  childSessionId: string;
  graphRunId: string;
  inputPrompt: string | null;
};

type ToolResultPayload = {
  kind: 'tool-result';
  toolName: string;
  result: unknown;
  reason: string;
};

type ArtifactPayload = {
  kind: 'artifact';
  artifact: ExecutionGraphArtifact;
};

type FinalAnswerPayload = {
  kind: 'final-answer';
  message: ChatMessage | null;
  turn: AgentTurn;
};

export type ExecutionGraphNodePayload =
  | PromptPayload
  | TurnPayload
  | ToolPayload
  | ToolGroupPayload
  | SubagentPayload
  | CliAgentPayload
  | AgentFlowPayload
  | ArchitectureRunPayload
  | ToolResultPayload
  | ArtifactPayload
  | FinalAnswerPayload;

export interface ExecutionGraphNode {
  id: string;
  kind: ExecutionGraphNodeKind;
  title: string;
  subtitle: string;
  detail?: string;
  status: ExecutionGraphNodeStatus;
  column: number;
  row: number;
  x: number;
  y: number;
  width: number;
  height: number;
  payload: ExecutionGraphNodePayload;
  sessionId?: string;
  turnId?: string;
  callId?: string;
}

export interface ExecutionGraphEdge {
  id: string;
  sourceId: string;
  targetId: string;
  style: 'solid' | 'dashed';
}

export interface ActiveAgentLoop {
  sessionId: string;
  turnId: string;
  startedAt: number;
  agentRun?: ToolActivity['agentRun'];
}

export interface BuildExecutionGraphModelInput {
  sessionId: string;
  messages: ChatMessage[];
  turns: AgentTurn[];
  toolActivities: ToolActivity[];
  activeAgentLoops: Record<string, ActiveAgentLoop>;
  sessions: ChatSession[];
  sessionMessages: Record<string, ChatMessage[]>;
  sessionAgentTurns?: Record<string, AgentTurn[]>;
  personas?: Persona[];
  collapseTools?: boolean;
}

export interface ExecutionGraphModel {
  nodes: ExecutionGraphNode[];
  edges: ExecutionGraphEdge[];
  board: { width: number; height: number };
  defaultSelectedNodeId: string | null;
}
