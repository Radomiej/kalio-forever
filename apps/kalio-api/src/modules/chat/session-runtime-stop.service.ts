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
    @Optional() private readonly moduleRef?: ModuleRef,
  ) {}

  async stopSessionTree(rootSessionId: string): Promise<RuntimeSnapshotSessionTree> {
    const sessionTree = await collectRuntimeSnapshotSessionTree(rootSessionId, this.sessionsService);
    const sessionIds = sessionTree.sessionIds;

    await this.stopArchitectureRunsForSessions(sessionIds);
    await this.stopAgentFlowRunsForSessions(sessionIds);

    for (const sessionId of sessionIds) {
      await this.stopCliAgentSessionIfNeeded(sessionId);
      await this.pipeline.stopAndDrain(sessionId);
    }

    return sessionTree;
  }

  private async stopArchitectureRunsForSessions(sessionIds: string[]): Promise<void> {
    const architectureRuntime = this.getArchitectureRuntimeStopPort();
    if (!architectureRuntime) {
      return;
    }
    try {
      await architectureRuntime.stopRunsForSessions(sessionIds);
    } catch (error) {
      this.logger.warn(`Failed to stop Architecture runs: ${error instanceof Error ? error.message : String(error)}`);
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
    for (const snapshot of activeSnapshots) {
      if (stoppedRunIds.has(snapshot.run.id)) {
        continue;
      }
      stoppedRunIds.add(snapshot.run.id);
      try {
        await agentFlowRuntime.stop(snapshot.run.id);
      } catch (error) {
        this.logger.warn(`Failed to stop AgentFlow run ${snapshot.run.id}: ${error instanceof Error ? error.message : String(error)}`);
      }
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
      this.logger.warn(`CLI agent stop failed for ${sessionId}: ${error instanceof Error ? error.message : String(error)}`);
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
}
