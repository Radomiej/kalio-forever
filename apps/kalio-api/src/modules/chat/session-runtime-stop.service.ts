import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import type { AgentFlowRunSnapshot } from '@kalio/types';
import { AGENT_FLOW_RUNTIME, type AgentFlowRuntimePort } from '../agent-flow/agent-flow-runtime.port';
import {
  CLI_AGENT_SESSION_RUNTIME,
  type CLIAgentSessionRuntimePort,
} from '../cli-agent/cli-agent-session-runtime.port';
import {
  ARCHITECTURE_RUNTIME_STOP,
  type ArchitectureRuntimeStopPort,
} from './architecture-runtime-stop.port';
import { SUBAGENT_RUNTIME, type SubagentRuntimePort } from '../tool/subagent-runtime.port';
import { findAgentFlowSnapshotsForSessions, isActiveAgentFlowSnapshot } from './chat.gateway.agentflow-stop';
import {
  collectRuntimeSnapshotSessionTree,
  type RuntimeSnapshotSessionTree,
} from './chat.runtime-snapshot';
import { SessionPipelineService } from './session-pipeline.service';
import { SessionsService } from './sessions.service';

@Injectable()
export class SessionRuntimeStopService {
  private readonly logger = new Logger(SessionRuntimeStopService.name);

  constructor(
    private readonly sessionsService: SessionsService,
    private readonly pipeline: SessionPipelineService,
    @Optional() @Inject(AGENT_FLOW_RUNTIME) private readonly agentFlowRuntime?: AgentFlowRuntimePort,
    @Optional() @Inject(CLI_AGENT_SESSION_RUNTIME) private readonly cliAgentSessionRuntime?: CLIAgentSessionRuntimePort,
    @Optional() @Inject(ARCHITECTURE_RUNTIME_STOP) private readonly architectureRuntimeStop?: ArchitectureRuntimeStopPort,
    @Optional() @Inject(SUBAGENT_RUNTIME) private readonly subagentRuntime?: SubagentRuntimePort,
    @Optional() private readonly moduleRef?: ModuleRef,
  ) {}

  async stopSessionTree(rootSessionId: string): Promise<RuntimeSnapshotSessionTree> {
    const sessionTree = await collectRuntimeSnapshotSessionTree(rootSessionId, this.sessionsService);
    const sessionIds = sessionTree.sessionIds;
    const failures: string[] = [];
    const attempt = async (label: string, operation: () => Promise<void>): Promise<void> => {
      try {
        await operation();
      } catch (error) {
        failures.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
      }
    };

    await attempt('Architecture runtime stop', () => this.stopArchitectureRunsForSessions(sessionIds));
    await attempt('AgentFlow runtime stop', () => this.stopAgentFlowRunsForSessions(sessionIds));
    await attempt('Subagent runtime stop', () => this.stopSubagentRunsForSessions(sessionIds));

    for (const sessionId of sessionIds) {
      await attempt(`CLI agent stop for ${sessionId}`, () => this.stopCliAgentSessionIfNeeded(sessionId));
      await attempt(`Chat pipeline drain for ${sessionId}`, () => this.pipeline.stopAndDrain(sessionId));
    }

    if (failures.length > 0) {
      throw new Error(`Session runtime did not become quiescent: ${failures.join('; ')}`);
    }

    return sessionTree;
  }

  private async stopSubagentRunsForSessions(sessionIds: string[]): Promise<void> {
    const subagentRuntime = this.getSubagentRuntime();
    if (!subagentRuntime?.stopAndDrainSessions) {
      return;
    }
    try {
      await subagentRuntime.stopAndDrainSessions(sessionIds);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Failed to stop subagent runs: ${message}`);
      throw error instanceof Error ? error : new Error(message);
    }
  }

  private async stopArchitectureRunsForSessions(sessionIds: string[]): Promise<void> {
    const architectureRuntime = this.getArchitectureRuntimeStopPort();
    if (!architectureRuntime) {
      return;
    }
    try {
      await architectureRuntime.stopRunsForSessions(sessionIds);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Failed to stop Architecture runs: ${message}`);
      throw error instanceof Error ? error : new Error(message);
    }
  }

  private async stopAgentFlowRunsForSessions(sessionIds: string[]): Promise<void> {
    const agentFlowRuntime = this.getAgentFlowRuntime();
    if (!agentFlowRuntime?.stop) {
      return;
    }
    const sessionIdSet = new Set(sessionIds);
    const snapshots = await findAgentFlowSnapshotsForSessions(agentFlowRuntime, sessionIds);
    const activeSnapshots = snapshots.filter((snapshot) => this.isAgentFlowSnapshotForSessions(snapshot, sessionIdSet));
    const stoppedRunIds = new Set<string>();
    const failures: string[] = [];
    for (const snapshot of activeSnapshots) {
      if (stoppedRunIds.has(snapshot.run.id)) {
        continue;
      }
      stoppedRunIds.add(snapshot.run.id);
      try {
        await agentFlowRuntime.stop(snapshot.run.id);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Failed to stop AgentFlow run ${snapshot.run.id}: ${message}`);
        failures.push(`${snapshot.run.id}: ${message}`);
      }
    }
    if (failures.length > 0) {
      throw new Error(`AgentFlow runs did not stop: ${failures.join('; ')}`);
    }
  }

  private isAgentFlowSnapshotForSessions(
    snapshot: AgentFlowRunSnapshot,
    sessionIdSet: ReadonlySet<string>,
  ): boolean {
    return isActiveAgentFlowSnapshot(snapshot) && (
      sessionIdSet.has(snapshot.run.parentSessionId)
      || sessionIdSet.has(snapshot.run.childSessionId)
      || (snapshot.run.openChatSessionId !== undefined && sessionIdSet.has(snapshot.run.openChatSessionId))
    );
  }

  private async stopCliAgentSessionIfNeeded(sessionId: string): Promise<void> {
    const cliRuntime = this.getCliAgentSessionRuntime();
    if (!cliRuntime) {
      return;
    }

    try {
      const session = await this.sessionsService.get(sessionId);
      if (session.kind !== 'cli-agent' || !session.parentSessionId) {
        return;
      }
      await cliRuntime.stopSession(session.parentSessionId, sessionId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`CLI agent stop failed for ${sessionId}: ${message}`);
      throw error instanceof Error ? error : new Error(message);
    }
  }

  private getArchitectureRuntimeStopPort(): ArchitectureRuntimeStopPort | undefined {
    if (this.architectureRuntimeStop) {
      return this.architectureRuntimeStop;
    }
    try {
      return this.moduleRef?.get<ArchitectureRuntimeStopPort>(ARCHITECTURE_RUNTIME_STOP, { strict: false });
    } catch {
      return undefined;
    }
  }

  private getAgentFlowRuntime(): AgentFlowRuntimePort | undefined {
    if (this.agentFlowRuntime) {
      return this.agentFlowRuntime;
    }
    try {
      return this.moduleRef?.get<AgentFlowRuntimePort>(AGENT_FLOW_RUNTIME, { strict: false });
    } catch {
      return undefined;
    }
  }

  private getCliAgentSessionRuntime(): CLIAgentSessionRuntimePort | undefined {
    if (this.cliAgentSessionRuntime) {
      return this.cliAgentSessionRuntime;
    }
    try {
      return this.moduleRef?.get<CLIAgentSessionRuntimePort>(CLI_AGENT_SESSION_RUNTIME, { strict: false });
    } catch {
      return undefined;
    }
  }

  private getSubagentRuntime(): SubagentRuntimePort | undefined {
    if (this.subagentRuntime) {
      return this.subagentRuntime;
    }
    try {
      return this.moduleRef?.get<SubagentRuntimePort>(SUBAGENT_RUNTIME, { strict: false });
    } catch {
      return undefined;
    }
  }
}
