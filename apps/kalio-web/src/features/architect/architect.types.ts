import type {
  ArchitectureChatProjection,
  ArchitectureExecutionMode,
  ArchitectureExecutionEvent,
  ArchitectureGraphProjection,
  ArchitectureNodeKind,
  ArchitectureRoleSlot,
  ArchitectureRun,
  ArchitectureSchema,
  ArchitectureSchemaNode,
  ArchitectureSchemaEdge,
  AgentFlowRunStatus,
  Persona,
} from '@kalio/types';

export interface ArchitectSlot {
  id: string;
  label: string;
  kind?: string;
  slotType?: ArchitectureRoleSlot['slotType'];
  defaultPersonaId?: string;
  allowedPersonaTags?: string[];
  required?: boolean;
  canOverrideAtRunStart?: boolean;
  description?: string;
}

export interface ArchitectNode {
  id: string;
  label: string;
  kind: ArchitectureNodeKind;
  role?: string;
  roleSlotId?: string;
  maxToolAttempts?: number;
  behavior?: ArchitectureSchemaNode['behavior'];
  personaId?: string;
  description?: string;
  x: number;
  y: number;
  slots: ArchitectSlot[];
  connections: string[];
}

export interface ArchitectCanvasSchema extends Omit<ArchitectureSchema, 'nodes'> {
  nodes: ArchitectNode[];
  edges: ArchitectureSchemaEdge[];
}

export type ArchitectSchema = ArchitectCanvasSchema;

export interface ArchitectRunEvent {
  id?: string;
  label?: string;
  message?: string;
  timestamp?: string;
  nodeId?: string;
  status?: string;
}

export interface ArchitectChatMessage {
  id?: string;
  role?: string;
  content?: string;
  nodeId?: string;
}

export interface ArchitectRunResult {
  run: ArchitectureRun;
  agentFlowRunId?: string;
  agentFlowStatus?: AgentFlowRunStatus;
  agentFlowSummary?: string;
  events: ArchitectureExecutionEvent[];
  graph: ArchitectureGraphProjection;
  chat: ArchitectureChatProjection;
}

export interface ExternalQualityGateInput {
  source: string;
  status: 'failed' | 'passed';
  highFindings: number;
  summary: string;
  artifactPath?: string;
}

export type PersonaOverrideMap = Record<string, string>;
export type NodeKindOverrideMap = Record<string, ArchitectureNodeKind>;
export type NodeBehaviorOverrideMap = Record<string, NonNullable<ArchitectureSchemaNode['behavior']>>;

export type ArchitectProjectionTab = 'editor' | 'events' | 'graph' | 'chat';

export type ArchitectPersona = Pick<Persona, 'id' | 'name' | 'systemPrompt' | 'model' | 'allowedTools'>;

export type ArchitectExecutionMode = ArchitectureExecutionMode;
