import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type {
  AgentFlowRun,
  AgentFlowRunSnapshot,
  AgentFlowTraceItem,
  SubAgentFlowResult,
} from '@kalio/types';
import { DrizzleService } from '../../database/drizzle.service';
import { agentFlowEvents, agentFlowRuns } from '../../database/schema';

function cloneJson<T>(value: T): T {
  return value === undefined || value === null ? value : structuredClone(value);
}

function cloneResult(result: SubAgentFlowResult): SubAgentFlowResult {
  return {
    ...result,
    decisions: [...result.decisions],
    nextActions: [...result.nextActions],
    artifacts: [...result.artifacts],
    tracePreview: result.tracePreview ? result.tracePreview.map(cloneTraceItem) : undefined,
  };
}

function cloneRun(run: AgentFlowRun): AgentFlowRun {
  return {
    ...run,
    activeNodeIds: run.activeNodeIds ? [...run.activeNodeIds] : undefined,
    completedNodeIds: run.completedNodeIds ? [...run.completedNodeIds] : undefined,
    activePhases: run.activePhases ? [...run.activePhases] : undefined,
    completedPhases: run.completedPhases ? [...run.completedPhases] : undefined,
    nodeVisitCounts: run.nodeVisitCounts ? { ...run.nodeVisitCounts } : undefined,
    checkpoint: cloneJson(run.checkpoint),
  };
}

function cloneTraceItem(item: AgentFlowTraceItem): AgentFlowTraceItem {
  return cloneJson(item);
}

function cloneSnapshot(snapshot: AgentFlowRunSnapshot): AgentFlowRunSnapshot {
  return {
    run: cloneRun(snapshot.run),
    events: snapshot.events.map(cloneTraceItem),
    ...(snapshot.result ? { result: cloneResult(snapshot.result) } : {}),
  };
}

@Injectable()
export class AgentFlowRunRepository {
  private readonly snapshots = new Map<string, AgentFlowRunSnapshot>();

  constructor(private readonly drizzle?: DrizzleService) {}

  clear(): void {
    this.snapshots.clear();
  }

  saveSnapshot(snapshot: AgentFlowRunSnapshot): void {
    const cloned = cloneSnapshot(snapshot);
    this.snapshots.set(snapshot.run.id, cloned);
    this.persistSnapshot(cloned);
  }

  getSnapshot(runId: string): AgentFlowRunSnapshot | undefined {
    const snapshot = this.snapshots.get(runId);
    if (snapshot) return cloneSnapshot(snapshot);
    const persisted = this.loadSnapshot(runId);
    if (!persisted) return undefined;
    this.snapshots.set(runId, cloneSnapshot(persisted));
    return persisted;
  }

  findByParentSessionId(parentSessionId: string): AgentFlowRunSnapshot[] {
    const persisted = this.findPersistedByParentSessionId(parentSessionId);
    for (const snapshot of persisted) {
      this.snapshots.set(snapshot.run.id, cloneSnapshot(snapshot));
    }
    return [...this.snapshots.values()]
      .filter((snapshot) => snapshot.run.parentSessionId === parentSessionId)
      .map((snapshot) => cloneSnapshot(snapshot));
  }

  findAll(): AgentFlowRunSnapshot[] {
    const persisted = this.findAllPersisted();
    for (const snapshot of persisted) {
      this.snapshots.set(snapshot.run.id, cloneSnapshot(snapshot));
    }
    return [...this.snapshots.values()].map((snapshot) => cloneSnapshot(snapshot));
  }

  upsertRun(run: AgentFlowRun): void {
    const current = this.snapshots.get(run.id);
    this.saveSnapshot({
      run,
      events: current ? current.events : [],
      ...(current?.result ? { result: current.result } : {}),
    });
  }

  appendEvent(runId: string, event: AgentFlowTraceItem): void {
    const snapshot = this.snapshots.get(runId);
    if (!snapshot) return;
    snapshot.events = [
      ...snapshot.events.filter((existing) => existing.id !== event.id),
      cloneTraceItem(event),
    ].sort((a, b) => a.sequence - b.sequence);
    this.snapshots.set(runId, snapshot);
    this.persistEvent(runId, event);
  }

  setResult(runId: string, result: SubAgentFlowResult | undefined): void {
    const snapshot = this.snapshots.get(runId);
    if (!snapshot) return;
    snapshot.result = result ? cloneResult(result) : undefined;
    this.snapshots.set(runId, snapshot);
    this.persistRun(snapshot);
  }

  private persistSnapshot(snapshot: AgentFlowRunSnapshot): void {
    if (!this.drizzle?.db) return;
    this.persistRun(snapshot);
    this.drizzle.db.delete(agentFlowEvents).where(eq(agentFlowEvents.runId, snapshot.run.id)).run();
    for (const event of snapshot.events) {
      this.persistEvent(snapshot.run.id, event);
    }
  }

  private persistRun(snapshot: AgentFlowRunSnapshot): void {
    if (!this.drizzle?.db) return;
    const run = cloneRun(snapshot.run);
    this.drizzle.db.insert(agentFlowRuns).values({
      id: run.id,
      parentSessionId: run.parentSessionId,
      parentToolCallId: run.parentToolCallId,
      childSessionId: run.childSessionId,
      openChatSessionId: run.openChatSessionId,
      openGraphRunId: run.openGraphRunId,
      flowDefinitionId: run.flowDefinitionId,
      status: run.status,
      startMode: run.startMode,
      returnMode: run.returnMode,
      waitingForNodeId: run.waitingForNodeId,
      activeNodeIds: run.activeNodeIds,
      completedNodeIds: run.completedNodeIds,
      activePhases: run.activePhases,
      completedPhases: run.completedPhases,
      nodeVisitCounts: run.nodeVisitCounts,
      maxIterations: run.maxIterations,
      returnToOrchestratorCount: run.returnToOrchestratorCount,
      checkpoint: run.checkpoint,
      result: snapshot.result ? cloneResult(snapshot.result) : undefined,
      summary: run.summary,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
      finishedAt: run.finishedAt,
    }).onConflictDoUpdate({
      target: agentFlowRuns.id,
      set: {
        parentSessionId: run.parentSessionId,
        parentToolCallId: run.parentToolCallId,
        childSessionId: run.childSessionId,
        openChatSessionId: run.openChatSessionId,
        openGraphRunId: run.openGraphRunId,
        flowDefinitionId: run.flowDefinitionId,
        status: run.status,
        startMode: run.startMode,
        returnMode: run.returnMode,
        waitingForNodeId: run.waitingForNodeId,
        activeNodeIds: run.activeNodeIds,
        completedNodeIds: run.completedNodeIds,
        activePhases: run.activePhases,
        completedPhases: run.completedPhases,
        nodeVisitCounts: run.nodeVisitCounts,
        maxIterations: run.maxIterations,
        returnToOrchestratorCount: run.returnToOrchestratorCount,
        checkpoint: run.checkpoint,
        result: snapshot.result ? cloneResult(snapshot.result) : undefined,
        summary: run.summary,
        updatedAt: run.updatedAt,
        finishedAt: run.finishedAt,
      },
    }).run();
  }

  private persistEvent(runId: string, event: AgentFlowTraceItem): void {
    if (!this.drizzle?.db) return;
    const cloned = cloneTraceItem(event);
    this.drizzle.db.insert(agentFlowEvents).values({
      id: cloned.id,
      runId,
      sequence: cloned.sequence,
      type: cloned.type,
      status: cloned.status,
      message: cloned.message,
      event: cloned,
      createdAt: cloned.createdAt,
    }).onConflictDoUpdate({
      target: agentFlowEvents.id,
      set: {
        runId,
        sequence: cloned.sequence,
        type: cloned.type,
        status: cloned.status,
        message: cloned.message,
        event: cloned,
        createdAt: cloned.createdAt,
      },
    }).run();
  }

  private loadSnapshot(runId: string): AgentFlowRunSnapshot | undefined {
    if (!this.drizzle?.db) return undefined;
    const [row] = this.drizzle.db.select().from(agentFlowRuns).where(eq(agentFlowRuns.id, runId)).all();
    if (!row) return undefined;
    return this.snapshotFromRunRow(row);
  }

  private findPersistedByParentSessionId(parentSessionId: string): AgentFlowRunSnapshot[] {
    if (!this.drizzle?.db) return [];
    const rows = this.drizzle.db.select().from(agentFlowRuns).where(eq(agentFlowRuns.parentSessionId, parentSessionId)).all();
    return rows.map((row) => this.snapshotFromRunRow(row));
  }

  private findAllPersisted(): AgentFlowRunSnapshot[] {
    if (!this.drizzle?.db) return [];
    const rows = this.drizzle.db.select().from(agentFlowRuns).all();
    return rows.map((row) => this.snapshotFromRunRow(row));
  }

  private snapshotFromRunRow(row: typeof agentFlowRuns.$inferSelect): AgentFlowRunSnapshot {
    const events = this.drizzle?.db
      .select()
      .from(agentFlowEvents)
      .where(eq(agentFlowEvents.runId, row.id))
      .all()
      .sort((a, b) => a.sequence - b.sequence)
      .map((eventRow) => cloneTraceItem(eventRow.event)) ?? [];

    const run: AgentFlowRun = {
      id: row.id,
      parentSessionId: row.parentSessionId,
      parentToolCallId: row.parentToolCallId ?? undefined,
      childSessionId: row.childSessionId,
      openChatSessionId: row.openChatSessionId ?? undefined,
      openGraphRunId: row.openGraphRunId ?? undefined,
      flowDefinitionId: row.flowDefinitionId,
      status: row.status,
      startMode: row.startMode,
      returnMode: row.returnMode,
      waitingForNodeId: row.waitingForNodeId ?? undefined,
      activeNodeIds: row.activeNodeIds ?? undefined,
      completedNodeIds: row.completedNodeIds ?? undefined,
      activePhases: row.activePhases ?? undefined,
      completedPhases: row.completedPhases ?? undefined,
      nodeVisitCounts: row.nodeVisitCounts ?? undefined,
      maxIterations: row.maxIterations ?? undefined,
      returnToOrchestratorCount: row.returnToOrchestratorCount ?? undefined,
      checkpoint: row.checkpoint ?? undefined,
      summary: row.summary ?? undefined,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      finishedAt: row.finishedAt ?? undefined,
    };

    return {
      run,
      events,
      ...(row.result ? { result: cloneResult(row.result) } : {}),
    };
  }
}
