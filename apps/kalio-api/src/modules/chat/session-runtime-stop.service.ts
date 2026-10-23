import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import type { AgentFlowRunSnapshot, ChatSession } from '@kalio/types';
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
import type { SessionStopLease, StopReleaseFailure } from './session-execution-admission';
import type { EmitFn } from './interfaces/stream-context.interface';

type CLIStopEmitter = (sessionId: string, parentSessionId: string) => EmitFn;

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

  async stopSessionTree(rootSessionId: string, emitForSession?: CLIStopEmitter): Promise<RuntimeSnapshotSessionTree> {
    return this.withStoppedTree(rootSessionId, async tree => tree, emitForSession);
  }

  async stopSessionTrees(sessionIds: readonly string[]): Promise<void> {
    const selected = [...new Set(sessionIds)];
    const trees = await Promise.all(selected.map(id => collectRuntimeSnapshotSessionTree(id, this.sessionsService)));
    const roots = selected.filter(id => !trees.some(tree => tree.rootSessionId !== id && tree.sessionIds.includes(id)));
    const outcomes = await Promise.allSettled(roots.map(id => this.stopSessionTree(id)));
    const errors = outcomes.flatMap(outcome => outcome.status === 'rejected' ? [outcome.reason as unknown] : []);
    if (errors.length > 0) throw new AggregateError(errors, `Session tree Stop failed: ${errors.map(String).join('; ')}`);
  }

  async withStoppedTree<T>(rootSessionId: string, action: (tree: RuntimeSnapshotSessionTree) => Promise<T>, emitForSession?: CLIStopEmitter): Promise<T> {
    const claim = this.sessionsService.claimTreeStop(rootSessionId);
    const leases: SessionStopLease[] = [];
    let releaseFailure: StopReleaseFailure | undefined;
    const failures: string[] = [];
    let openOwners!: () => void;
    const ownersSettled = new Promise<void>(resolve => { openOwners = resolve; });
    const attempt = async (label: string, operation: () => Promise<void>): Promise<void> => {
      try {
        await operation();
      } catch (error) {
        failures.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
      }
    };

    try {
      const sessionTree = await collectRuntimeSnapshotSessionTree(rootSessionId, this.sessionsService);
      const sessionIds = sessionTree.sessionIds;
      // Fail before acquiring anything or starting owners if a weaker Stop exists.
      this.pipeline.assertStopLeasesAvailable(sessionIds);
      // No await here: every existing session is fenced before external owners start.
      for (const sessionId of sessionIds) {
        try { leases.push(this.pipeline.acquireStopLease(sessionId, ownersSettled)); }
        catch (error) { failures.push(`Pipeline lease for ${sessionId}: ${String(error)}`); }
      }
      await Promise.allSettled([
        attempt('Architecture runtime stop', () => this.stopArchitectureRunsForSessions(sessionIds)),
        attempt('AgentFlow runtime stop', () => this.stopAgentFlowRunsForSessions(sessionIds)),
        attempt('Subagent runtime stop', () => this.stopSubagentRunsForSessions(sessionIds)),
        ...sessionIds.map(sessionId =>
          attempt(`CLI agent stop for ${sessionId}`, () => this.stopCliAgentSessionIfNeeded(sessionId, sessionTree.childSessionsById[sessionId], emitForSession)),
        ),
      ]);
      openOwners();
      const outcomes = await Promise.all(leases.map(lease => lease.ready));
      outcomes.forEach(outcome => failures.push(...outcome.errors.map(String)));
      if (failures.length > 0) throw new Error(`Session runtime did not become quiescent: ${failures.join('; ')}`);
      return await action(sessionTree);
    } catch (error) {
      releaseFailure = { error };
      throw error;
    } finally {
      openOwners();
      leases.forEach(lease => lease.release(releaseFailure));
      try { await Promise.all(leases.map(lease => lease.completion)); }
      finally { claim.release(); }
    }
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

  private async stopCliAgentSessionIfNeeded(sessionId: string, collectedSession?: ChatSession, emitForSession?: CLIStopEmitter): Promise<void> {
    const cliRuntime = this.getCliAgentSessionRuntime();
    if (!cliRuntime) {
      return;
    }

    try {
      // Cancellation owners may remove children while draining; use the collected ownership.
      const session = collectedSession ?? await this.sessionsService.get(sessionId);
      if (session.kind !== 'cli-agent' || !session.parentSessionId) {
        return;
      }
      if (emitForSession) await cliRuntime.stopSession(session.parentSessionId, sessionId, emitForSession(sessionId, session.parentSessionId));
      else await cliRuntime.stopSession(session.parentSessionId, sessionId);
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
