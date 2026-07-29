import { Injectable, Logger } from '@nestjs/common';
import type {
  ArchitectureChildAgentProjection,
  ArchitectureExecutionEvent,
  ArchitectureGraphProjection,
  ArchitectureRun,
  ArchitectureSchema,
} from '@kalio/types';
import { SessionsService } from '../chat/sessions.service';
import { ArchitectureRegistryService } from './architecture-registry.service';
import { mergeChildAgentStatus } from './architecture-cli-child-status';
import { reconstructDurableArchitectureGraph } from './architecture-durable-graph';
import { buildArchitectureGraphProjection } from './architecture-graph-projection';

const PERSISTED_GRAPH_RECOVERY_TIMEOUT_MS = 1500;

@Injectable()
export class ArchitectureRuntimeGraphProjectionService {
  private readonly logger = new Logger(ArchitectureRuntimeGraphProjectionService.name);

  constructor(
    private readonly sessions: SessionsService,
    private readonly registry: ArchitectureRegistryService,
  ) {}

  build(
    runId: string,
    schema: ArchitectureSchema,
    events: ArchitectureExecutionEvent[],
    status: ArchitectureRun['status'],
  ): ArchitectureGraphProjection {
    return buildArchitectureGraphProjection(runId, schema, events, status);
  }

  async reconstructPersisted(runId: string): Promise<ArchitectureGraphProjection | null> {
    try {
      return await this.withTimeout(
        reconstructDurableArchitectureGraph(runId, this.sessions, this.registry),
        PERSISTED_GRAPH_RECOVERY_TIMEOUT_MS,
        `persisted architecture graph recovery timed out after ${PERSISTED_GRAPH_RECOVERY_TIMEOUT_MS}ms`,
      );
    } catch (error) {
      this.logger.warn(
        `Failed to reconstruct architecture graph from persisted chat for run ${runId}: ${this.errorMessage(error)}`,
      );
      return null;
    }
  }

  mergePersistedChildAgents(
    liveGraph: ArchitectureGraphProjection,
    persistedGraph: ArchitectureGraphProjection | null,
  ): ArchitectureGraphProjection {
    const persistedChildAgents = persistedGraph?.childAgents ?? [];
    if (persistedChildAgents.length === 0) {
      return liveGraph;
    }
    const childAgents = new Map<string, NonNullable<ArchitectureGraphProjection['childAgents']>[number]>();
    for (const childAgent of liveGraph.childAgents ?? []) {
      childAgents.set(childAgent.id, childAgent);
    }
    for (const childAgent of persistedChildAgents) {
      childAgents.set(childAgent.id, this.mergeChildAgentProjection(childAgents.get(childAgent.id), childAgent));
    }
    return {
      ...liveGraph,
      childAgents: [...childAgents.values()],
    };
  }

  private mergeChildAgentProjection(
    current: ArchitectureChildAgentProjection | undefined,
    incoming: ArchitectureChildAgentProjection,
  ): ArchitectureChildAgentProjection {
    return {
      id: incoming.id,
      parentNodeId: incoming.parentNodeId ?? current?.parentNodeId,
      parentRoleSlotId: incoming.parentRoleSlotId ?? current?.parentRoleSlotId,
      parentEventId: incoming.parentEventId ?? current?.parentEventId,
      kind: incoming.kind ?? current?.kind ?? 'cli-agent',
      backend: incoming.backend ?? current?.backend,
      status: mergeChildAgentStatus(current?.status, incoming.status),
      toolName: incoming.toolName ?? current?.toolName,
      workdir: incoming.workdir ?? current?.workdir,
      targetPaths: incoming.targetPaths ?? current?.targetPaths,
      updatedAt: incoming.updatedAt ?? current?.updatedAt,
    };
  }

  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
    let timeout: ReturnType<typeof setTimeout> | null = null;
    try {
      return await Promise.race([
        promise,
        new Promise<T>((_resolve, reject) => {
          timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
          timeout.unref?.();
        }),
      ]);
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
    }
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
