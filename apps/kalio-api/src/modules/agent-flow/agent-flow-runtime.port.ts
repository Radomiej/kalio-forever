import type {
  AgentFlowRunSnapshot,
  ResumeAgentFlowRunDto,
  RunSubAgentFlowArgs,
  SubAgentFlowResult,
} from '@kalio/types';

export const AGENT_FLOW_RUNTIME = Symbol('AGENT_FLOW_RUNTIME');

export interface AgentFlowRuntimePort {
  run(args: RunSubAgentFlowArgs): Promise<SubAgentFlowResult>;
  start?(args: RunSubAgentFlowArgs): Promise<AgentFlowRunSnapshot>;
  resume?(runId: string, dto: ResumeAgentFlowRunDto, args?: RunSubAgentFlowArgs): Promise<AgentFlowRunSnapshot>;
  stop?(runId: string, args?: RunSubAgentFlowArgs): Promise<AgentFlowRunSnapshot | null | void>;
  getSnapshot?(runId: string, args?: RunSubAgentFlowArgs): Promise<AgentFlowRunSnapshot | null>;
  findByParentSessionId?(parentSessionId: string): Promise<AgentFlowRunSnapshot[]>;
  findAll?(): Promise<AgentFlowRunSnapshot[]>;
}
