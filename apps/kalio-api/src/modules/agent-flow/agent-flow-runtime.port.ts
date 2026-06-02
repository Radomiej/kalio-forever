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
  getSnapshot?(runId: string, args?: RunSubAgentFlowArgs): Promise<AgentFlowRunSnapshot | null>;
}
