import type { Logger } from '@nestjs/common';
import type { ModuleRef } from '@nestjs/core';
import type { SocketEvents } from '@kalio/types';
import { AGENT_FLOW_RUNTIME, type AgentFlowRuntimePort } from '../agent-flow/agent-flow-runtime.port';
import { CLI_AGENT_SESSION_RUNTIME, type CLIAgentSessionRuntimePort } from '../cli-agent/cli-agent-session-runtime.port';
import { SUBAGENT_RUNTIME, type SubagentRuntimePort } from '../tool/subagent-runtime.port';
import type { EmitFn } from './interfaces/stream-context.interface';
import { getSocketEventSessionId } from './chat.gateway.event-routing';

type RuntimeDeps = {
  logger: Logger;
  moduleRef?: ModuleRef;
  agentFlowRuntime?: AgentFlowRuntimePort;
  cliAgentSessionRuntime?: CLIAgentSessionRuntimePort;
  subagentRuntime?: SubagentRuntimePort;
  emit<K extends keyof SocketEvents>(initiatorSocketId: string, sessionId: string, event: K, data: SocketEvents[K]): void;
};

/** Gateway runtime lookup only; SessionRuntimeStopService owns all Stop orchestration. */
export class ChatGatewayRuntime {
  constructor(private readonly deps: RuntimeDeps) {}

  cliStopEmitter(initiator: string, sessionId: string, parentSessionId: string): EmitFn {
    return (event, data) => {
      const target = getSocketEventSessionId(data);
      if (target) this.deps.emit(initiator, target, event, data);
      else {
        this.deps.emit(initiator, parentSessionId, event, data);
        if (sessionId !== parentSessionId) this.deps.emit(initiator, sessionId, event, data);
      }
    };
  }

  getCliAgentSessionRuntime(): CLIAgentSessionRuntimePort | undefined {
    return this.lookup(this.deps.cliAgentSessionRuntime, CLI_AGENT_SESSION_RUNTIME, 'CLI agent');
  }

  getAgentFlowRuntime(): AgentFlowRuntimePort | undefined {
    return this.lookup(this.deps.agentFlowRuntime, AGENT_FLOW_RUNTIME, 'AgentFlow');
  }

  getSubagentRuntime(): SubagentRuntimePort | undefined {
    return this.lookup(this.deps.subagentRuntime, SUBAGENT_RUNTIME, 'Subagent');
  }

  private lookup<T>(injected: T | undefined, token: symbol, name: string): T | undefined {
    if (injected) return injected;
    try {
      return this.deps.moduleRef?.get<T>(token, { strict: false });
    } catch (error) {
      this.deps.logger.warn(`${name} runtime lookup failed: ${error instanceof Error ? error.message : String(error)}`);
      return undefined;
    }
  }
}

export function nextApprovedBudgetLimit(
  currentLimit: number,
  decision: SocketEvents['agent:budget_approve']['decision'],
): number | null {
  switch (decision) {
    case 'allow_one':
      return currentLimit + 1;
    case 'allow_ten':
      return currentLimit + 10;
    case 'allow_unlimited':
      return 1000;
    case 'block':
    default:
      return null;
  }
}
