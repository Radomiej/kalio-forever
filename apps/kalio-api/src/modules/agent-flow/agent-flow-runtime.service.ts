import { Injectable } from '@nestjs/common';
import type {
  AgentFlowRunSnapshot,
  ResumeAgentFlowRunDto,
  RunSubAgentFlowArgs,
  SubAgentFlowResult,
  AgentFlowTraceItem,
} from '@kalio/types';
import { ArchitectureAgentFlowAdapter } from './architecture-agent-flow.adapter';
import { AgentFlowRunRepository } from './agent-flow-run.repository';
import type { AgentFlowRuntimePort } from './agent-flow-runtime.port';
import { VFSService } from '../vfs/vfs.service';
import {
  argsFromRun,
  cloneTrace,
  copyBackEventExists,
  createResumeEvent,
  createResumeFailedEvent,
  createRunFromResult,
  markRuntimeMissing,
  mergeRefreshedAfterResume,
  mergeRefreshedSnapshot,
  mergeResumeCheckpoint,
  reconcileContinuationSnapshot,
  withCheckpoint,
} from './agent-flow-runtime.helpers';

const DURABLE_RECONCILE_INTERVAL_MS = 1000;
const DURABLE_RECONCILE_MAX_ATTEMPTS = 180;

@Injectable()
export class AgentFlowRuntimeService implements AgentFlowRuntimePort {
  constructor(
    private readonly adapter: ArchitectureAgentFlowAdapter,
    private readonly repository: AgentFlowRunRepository,
    private readonly vfs?: VFSService,
  ) {}

  async run(args: RunSubAgentFlowArgs): Promise<SubAgentFlowResult> {
    const result = this.withResultIdentity(await this.adapter.run(args), args);
    const now = Date.now();
    const snapshot = this.copyBackIfNeeded({
      run: {
        ...createRunFromResult(args, result),
        updatedAt: now,
      },
      result,
      events: cloneTrace(result.tracePreview),
    });
    this.repository.saveSnapshot(snapshot);
    return snapshot.result ?? result;
  }

  async start(args: RunSubAgentFlowArgs): Promise<AgentFlowRunSnapshot> {
    if (args.startMode === 'blocking') {
      const result = await this.run(args);
      return {
        run: createRunFromResult(args, result),
        result,
        events: cloneTrace(result.tracePreview),
      };
    }

    const snapshot = await this.adapter.start(args);
    const checkpointed = this.copyBackIfNeeded(this.withSnapshotRunIdentity(withCheckpoint(snapshot, args), args));
    const normalized = this.withSnapshotResultIdentity(checkpointed);
    this.repository.saveSnapshot(normalized);
    this.scheduleDurableReconciliation(checkpointed.run.id);
    return normalized;
  }

  async resume(runId: string, dto: ResumeAgentFlowRunDto): Promise<AgentFlowRunSnapshot> {
    const storedSnapshot = this.repository.getSnapshot(runId);
    const snapshot = storedSnapshot ? reconcileContinuationSnapshot(storedSnapshot) : null;
    if (!snapshot) {
      throw new Error(`AGENT_FLOW_RUN_NOT_FOUND: ${runId}`);
    }
    if (snapshot.run.status !== 'waiting_on_orchestrator' && !isResumableBlockedSnapshot(snapshot)) {
      throw new Error(`AGENT_FLOW_RUN_NOT_WAITING: ${runId}`);
    }

    const now = Date.now();
    const sequence = snapshot.events.length + 1;
    const resumeEvent: AgentFlowTraceItem = createResumeEvent(runId, sequence, dto);
    this.repository.appendEvent(runId, resumeEvent);

    const updated: AgentFlowRunSnapshot = {
      run: {
        ...snapshot.run,
        status: 'running',
        waitingForNodeId: undefined,
        checkpoint: mergeResumeCheckpoint(snapshot.run, dto),
        updatedAt: now,
      },
      events: [
        ...snapshot.events,
        resumeEvent,
      ],
      result: snapshot.result,
    };
    this.repository.saveSnapshot(updated);
    const runtimeAdapter = this.adapter as AgentFlowRuntimePort;
    const resumeArgs = argsFromRun(updated.run);
    let refreshed: AgentFlowRunSnapshot | null | undefined;
    try {
      refreshed = runtimeAdapter.resume
        ? await runtimeAdapter.resume(runId, dto, resumeArgs)
        : await runtimeAdapter.getSnapshot?.(runId, resumeArgs);
    } catch (error) {
      const recovered = await runtimeAdapter.getSnapshot?.(runId, resumeArgs);
      if (recovered && hasRuntimeProgressAfterResume(updated, recovered)) {
        const merged = this.copyBackIfNeeded(mergeRefreshedAfterResume(updated, recovered));
        this.repository.saveSnapshot(merged);
        return this.repository.getSnapshot(runId) ?? merged;
      }
      const failedEvent = createResumeFailedEvent(runId, updated.events.length + 1, error);
      const blocked: AgentFlowRunSnapshot = {
        ...updated,
        run: {
          ...updated.run,
          status: 'blocked',
          updatedAt: failedEvent.createdAt,
          finishedAt: failedEvent.createdAt,
          summary: updated.run.summary ?? 'Blocked because AgentFlow resume failed.',
        },
        events: [
          ...updated.events,
          failedEvent,
        ],
        result: updated.result
          ? {
              ...updated.result,
              status: 'blocked',
              summary: updated.result.summary || 'Blocked because AgentFlow resume failed.',
            }
          : undefined,
      };
      this.repository.saveSnapshot(blocked);
      throw error;
    }
    if (!refreshed) {
      return this.repository.getSnapshot(runId) ?? updated;
    }
    const merged = this.copyBackIfNeeded(mergeRefreshedAfterResume(updated, refreshed));
    this.repository.saveSnapshot(merged);
    return this.repository.getSnapshot(runId) ?? merged;
  }

  async stop(runId: string): Promise<AgentFlowRunSnapshot> {
    const snapshot = this.repository.getSnapshot(runId);
    if (!snapshot) {
      throw new Error(`AGENT_FLOW_RUN_NOT_FOUND: ${runId}`);
    }
    await this.adapter.stop?.(runId, argsFromRun(snapshot.run));
    const now = Date.now();
    const stopEvent: AgentFlowTraceItem = {
      id: `agent-flow:${runId}:event:${snapshot.events.length + 1}:stopped`,
      sequence: snapshot.events.length + 1,
      type: 'flow:stopped',
      status: 'cancelled',
      message: 'AgentFlow run stopped by user.',
      createdAt: now,
    };
    const stopped: AgentFlowRunSnapshot = {
      run: {
        ...snapshot.run,
        status: 'cancelled',
        updatedAt: now,
        finishedAt: now,
        summary: snapshot.run.summary ?? 'Stopped by user.',
      },
      events: [...snapshot.events, stopEvent],
      ...(snapshot.result ? {
        result: {
          ...snapshot.result,
          status: 'cancelled',
          summary: snapshot.result.summary || 'Stopped by user.',
        },
      } : {}),
    };
    this.repository.saveSnapshot(stopped);
    return this.repository.getSnapshot(runId) ?? stopped;
  }

  async getSnapshot(runId: string): Promise<AgentFlowRunSnapshot | null> {
    const snapshot = this.repository.getSnapshot(runId);
    if (!snapshot) return null;
    const stored = reconcileContinuationSnapshot(snapshot);
    if (stored.run.status !== snapshot.run.status) {
      this.repository.saveSnapshot(stored);
    }
    const refreshed = await this.adapter.getSnapshot(runId, argsFromRun(stored.run));
    if (!refreshed) {
      if (stored.run.status === 'waiting_on_orchestrator') {
        return this.repository.getSnapshot(runId) ?? stored;
      }
      const blocked = markRuntimeMissing(stored);
      if (blocked !== stored) {
        this.repository.saveSnapshot(blocked);
      }
      return this.repository.getSnapshot(runId) ?? blocked;
    }
    const reconciled = this.copyBackIfNeeded(mergeRefreshedSnapshot(stored, refreshed));
    this.repository.saveSnapshot(reconciled);
    return this.repository.getSnapshot(runId) ?? reconciled;
  }

  async findByParentSessionId(parentSessionId: string): Promise<AgentFlowRunSnapshot[]> {
    const snapshots = this.repository.findByParentSessionId(parentSessionId);
    return Promise.all(snapshots.map(async (snapshot) => (await this.getSnapshot(snapshot.run.id)) ?? snapshot));
  }

  async findAll(): Promise<AgentFlowRunSnapshot[]> {
    const snapshots = this.repository.findAll();
    return Promise.all(snapshots.map(async (snapshot) => (await this.getSnapshot(snapshot.run.id)) ?? snapshot));
  }

  private scheduleDurableReconciliation(runId: string): void {
    let attempts = 0;
    const reconcile = async (): Promise<void> => {
      attempts += 1;
      const snapshot = this.repository.getSnapshot(runId);
      if (!snapshot || snapshot.run.status !== 'running') {
        return;
      }

      const refreshed = await this.adapter.getSnapshot(runId, argsFromRun(snapshot.run));
      if (refreshed) {
        const reconciled = mergeRefreshedSnapshot(snapshot, refreshed);
        this.repository.saveSnapshot(this.copyBackIfNeeded(reconciled));
        if (reconciled.run.status !== 'running') {
          return;
        }
      }

      if (!refreshed && attempts >= DURABLE_RECONCILE_MAX_ATTEMPTS) {
        this.repository.saveSnapshot(markRuntimeMissing(snapshot));
        return;
      }

      if (attempts < DURABLE_RECONCILE_MAX_ATTEMPTS) {
        setTimeout(() => void reconcile(), DURABLE_RECONCILE_INTERVAL_MS);
      }
    };

    setTimeout(() => void reconcile(), DURABLE_RECONCILE_INTERVAL_MS);
  }

  private copyBackIfNeeded(snapshot: AgentFlowRunSnapshot): AgentFlowRunSnapshot {
    const { run } = snapshot;
    if (
      !this.vfs
      || run.status !== 'done'
      || run.checkpoint?.copyBack !== true
      || run.checkpoint.vfsMode !== 'isolated'
      || copyBackEventExists(snapshot)
    ) {
      return snapshot;
    }

    const copiedFiles = this.vfs.copySessionFiles({
      fromSessionId: run.childSessionId,
      toSessionId: run.parentSessionId,
      targetPrefix: `agent-flows/${run.id}`,
    });
    if (copiedFiles.length === 0) {
      return snapshot;
    }
    const artifacts = copiedFiles.map((file) => file.toPath);
    const lastEvent = snapshot.events.at(-1);
    const event: AgentFlowTraceItem = {
      id: `agent-flow:${run.id}:event:${snapshot.events.length + 1}:copy_back`,
      sequence: (lastEvent?.sequence ?? snapshot.events.length) + 1,
      type: 'flow:copy_back',
      lifecycle: 'copy_back',
      message: `Copied ${copiedFiles.length} AgentFlow artifact(s) back to the parent session.`,
      data: {
        copiedFiles,
        fromSessionId: run.childSessionId,
        toSessionId: run.parentSessionId,
      },
      status: 'done',
      createdAt: Date.now(),
    };
    return {
      ...snapshot,
      result: {
        ...(snapshot.result ?? {
          flowRunId: run.id,
          parentSessionId: run.parentSessionId,
          parentToolCallId: run.parentToolCallId,
          childSessionId: run.childSessionId,
          status: run.status,
          summary: run.summary ?? `AgentFlow ${run.flowDefinitionId} finished with status ${run.status}.`,
          decisions: [],
          nextActions: [],
          artifacts: [],
          openChatSessionId: run.openChatSessionId,
          openGraphRunId: run.openGraphRunId,
        }),
        artifacts: Array.from(new Set([...(snapshot.result?.artifacts ?? []), ...artifacts])),
      },
      events: [...snapshot.events, event],
    };
  }

  private withResultIdentity(result: SubAgentFlowResult, args: RunSubAgentFlowArgs): SubAgentFlowResult {
    return {
      ...result,
      parentSessionId: args.parentSessionId,
      parentToolCallId: args.parentToolCallId,
    };
  }

  private withSnapshotResultIdentity(snapshot: AgentFlowRunSnapshot): AgentFlowRunSnapshot {
    if (!snapshot.result) return snapshot;
    return {
      ...snapshot,
      result: {
        ...snapshot.result,
        parentSessionId: snapshot.run.parentSessionId,
        parentToolCallId: snapshot.run.parentToolCallId,
        childSessionId: snapshot.run.childSessionId,
        openChatSessionId: snapshot.run.openChatSessionId ?? snapshot.result.openChatSessionId,
        openGraphRunId: snapshot.run.openGraphRunId ?? snapshot.result.openGraphRunId,
      },
    };
  }

  private withSnapshotRunIdentity(snapshot: AgentFlowRunSnapshot, args: RunSubAgentFlowArgs): AgentFlowRunSnapshot {
    return {
      ...snapshot,
      run: {
        ...snapshot.run,
        parentSessionId: args.parentSessionId,
        parentToolCallId: args.parentToolCallId,
        flowDefinitionId: args.flowId,
        startMode: args.startMode ?? snapshot.run.startMode,
        returnMode: args.returnMode ?? snapshot.run.returnMode,
      },
    };
  }
}

function isResumableBlockedSnapshot(snapshot: AgentFlowRunSnapshot): boolean {
  return snapshot.run.status === 'blocked'
    && snapshot.events.some((event) => event.type === 'flow:final_artifact_blocker');
}

function hasRuntimeProgressAfterResume(
  updated: AgentFlowRunSnapshot,
  refreshed: AgentFlowRunSnapshot,
): boolean {
  if (refreshed.run.status !== 'running') {
    return true;
  }
  const knownEventIds = new Set(updated.events.map((event) => event.id));
  return refreshed.events.some((event) => !knownEventIds.has(event.id));
}
