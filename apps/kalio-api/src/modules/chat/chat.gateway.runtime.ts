import type { Logger } from '@nestjs/common';
import type { ModuleRef } from '@nestjs/core';
import type { SocketEvents } from '@kalio/types';
import { AGENT_FLOW_RUNTIME, type AgentFlowRuntimePort } from '../agent-flow/agent-flow-runtime.port';
import { CLI_AGENT_SESSION_RUNTIME, type CLIAgentSessionRuntimePort } from '../cli-agent/cli-agent-session-runtime.port';
import { SUBAGENT_RUNTIME, type SubagentRuntimePort } from '../tool/subagent-runtime.port';
import { ARCHITECTURE_RUNTIME_STOP, type ArchitectureRuntimeStopPort } from './architecture-runtime-stop.port';
import type { EmitFn } from './interfaces/stream-context.interface';
import type { SessionsService } from './sessions.service';
import { findAgentFlowSnapshotsForSessions, isActiveAgentFlowSnapshot } from './chat.gateway.agentflow-stop';
import { getSocketEventSessionId } from './chat.gateway.event-routing';

type RuntimeDeps = {
  sessionsService: SessionsService;
  logger: Logger;
  moduleRef?: ModuleRef;
  agentFlowRuntime?: AgentFlowRuntimePort;
  cliAgentSessionRuntime?: CLIAgentSessionRuntimePort;
  architectureRuntimeStop?: ArchitectureRuntimeStopPort;
  subagentRuntime?: SubagentRuntimePort;
  emit<K extends keyof SocketEvents>(initiatorSocketId: string, sessionId: string, event: K, data: SocketEvents[K]): void;
};

/** Existing gateway runtime lookup and descendant Stop orchestration, not an admission owner. */
export class ChatGatewayRuntime {
  constructor(private readonly deps: RuntimeDeps) {}

  async stopAgentFlowRunsForSessions(sessionIds: string[]): Promise<void> {
    const runtime = this.getAgentFlowRuntime();
    if (!runtime?.stop) return;
    const ids = new Set(sessionIds);
    const snapshots = await findAgentFlowSnapshotsForSessions(runtime, sessionIds);
    const stopped = new Set<string>();
    for (const snapshot of snapshots) {
      if (!isActiveAgentFlowSnapshot(snapshot) || !(ids.has(snapshot.run.parentSessionId)
        || ids.has(snapshot.run.childSessionId)
        || (snapshot.run.openChatSessionId !== undefined && ids.has(snapshot.run.openChatSessionId)))
        || stopped.has(snapshot.run.id)) continue;
      stopped.add(snapshot.run.id);
      try {
        await runtime.stop(snapshot.run.id);
      } catch (error) {
        this.deps.logger.warn(`Failed to stop AgentFlow run ${snapshot.run.id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  async stopArchitectureRunsForSessions(sessionIds: string[]): Promise<void> {
    const runtime = this.lookup(this.deps.architectureRuntimeStop, ARCHITECTURE_RUNTIME_STOP, 'Architecture');
    if (!runtime) return;
    try {
      await runtime.stopRunsForSessions(sessionIds);
    } catch (error) {
      this.deps.logger.warn(`Failed to stop Architecture runs: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async stopCliAgentSessionIfNeeded(initiatorSocketId: string, sessionId: string): Promise<void> {
    const runtime = this.getCliAgentSessionRuntime();
    if (!runtime) return;
    try {
      const session = await this.deps.sessionsService.get(sessionId);
      if (session.kind !== 'cli-agent' || !session.parentSessionId) return;
      const parentSessionId = session.parentSessionId;
      const emit: EmitFn = (event, data) => {
        const eventSessionId = getSocketEventSessionId(data);
        if (eventSessionId) {
          this.deps.emit(initiatorSocketId, eventSessionId, event, data);
          return;
        }
        this.deps.emit(initiatorSocketId, parentSessionId, event, data);
        if (sessionId !== parentSessionId) this.deps.emit(initiatorSocketId, sessionId, event, data);
      };
      await runtime.stopSession(parentSessionId, sessionId, emit);
    } catch (error) {
      this.deps.logger.warn(`CLI agent stop failed for ${sessionId}: ${error instanceof Error ? error.message : String(error)}`);
    }
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
