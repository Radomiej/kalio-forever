import type {
  ArchitectureExecutionEvent,
  ArchitectureRun,
  ArchitectureSchema,
  WorkflowFailure,
} from '@kalio/types';
import { describe, expect, it, vi } from 'vitest';
import type { AuditService } from '../chat/audit.service';
import { RuntimeAuditLogger } from '../chat/runtime-audit-logger.service';
import {
  ArchitectureRuntimeAuditWriterService,
} from './architecture-runtime-audit.service';
import type { ArchitectureVfsHydrationResult } from './architecture-vfs-hydration';

describe('ArchitectureRuntimeAuditWriterService', () => {
  it('persists pause lifecycle and reason in required route checkpoints', async () => {
    const logRequired = vi.fn(async () => undefined);
    const writer = new ArchitectureRuntimeAuditWriterService({ logRequired } as unknown as AuditService);
    await writer.logRouteDecisionRequired(
      { id: 'schema' } as ArchitectureSchema, { id: 'run', rootSessionId: 'root' } as ArchitectureRun,
      { id: 'pause', runId: 'run', createdAt: 1, type: 'router_decision', sequence: 3, message: 'Review needs user input',
        lifecycle: 'waiting_on_orchestrator', status: 'waiting_on_orchestrator', reasonCode: 'runtime_pause',
        data: { pendingNodeIds: ['judge'], visitCounts: { worker: 1 } } } as ArchitectureExecutionEvent,
      'run:goal-pause:3',
    );
    expect(logRequired).toHaveBeenCalledWith('run:goal-pause:3', expect.objectContaining({
      data: expect.objectContaining({ lifecycle: 'waiting_on_orchestrator', status: 'waiting_on_orchestrator',
        reasonCode: 'runtime_pause', pendingNodeIds: ['judge'] }),
    }));
  });
  it('requires durable storage before accepting an auto-route checkpoint', async () => {
    const writer = new ArchitectureRuntimeAuditWriterService();
    await expect(writer.logRouteDecisionRequired(
      { id: 'schema' } as ArchitectureSchema,
      { id: 'run' } as ArchitectureRun,
      { id: 'decision' } as ArchitectureExecutionEvent,
      'run:judge:1',
    )).rejects.toThrow('Durable audit storage');
  });

  it('awaits the checkpoint write and preserves recovery metadata', async () => {
    let resolveWrite!: () => void;
    let saved: unknown;
    const audit = {
      logRequired: (_id: string, input: unknown) => {
        saved = input;
        return new Promise<void>((resolve) => { resolveWrite = resolve; });
      },
    };
    const writer = new ArchitectureRuntimeAuditWriterService(audit as unknown as AuditService);
    const event = {
      id: 'decision', type: 'router_decision', sequence: 3, message: 'Continue',
      data: { kind: 'auto_routing_decision', autoRoutingVisit: 2,
        selectedEdgeId: 'continue', pendingNodeIds: ['worker'], visitCounts: { judge: 2 } },
    } as unknown as ArchitectureExecutionEvent;
    let acknowledged = false;
    const write = writer.logRouteDecisionRequired(
      { id: 'schema' } as ArchitectureSchema, { id: 'run' } as ArchitectureRun,
      event, 'run:judge:2',
    ).then(() => { acknowledged = true; });
    await Promise.resolve();
    expect(acknowledged).toBe(false);
    expect(saved).toMatchObject({ data: { autoRoutingVisit: 2, selectedEdgeId: 'continue',
      pendingNodeIds: ['worker'], visitCounts: { judge: 2 } } });
    resolveWrite();
    await write;
    expect(acknowledged).toBe(true);
  });

  it('propagates a checkpoint failure instead of permitting dispatch', async () => {
    const audit = { logRequired: async () => { throw new Error('disk full'); } };
    const writer = new ArchitectureRuntimeAuditWriterService(audit as unknown as AuditService);
    await expect(writer.logRouteDecisionRequired(
      { id: 'schema' } as ArchitectureSchema, { id: 'run' } as ArchitectureRun,
      { type: 'router_decision', message: 'Continue' } as ArchitectureExecutionEvent,
      'run:judge:1',
    )).rejects.toThrow('disk full');
  });

  it('preserves runtime and event audit writes while honoring the event toggle', () => {
    const audit = {
      log: vi.fn().mockResolvedValue('audit-id'),
    };
    const writer = new ArchitectureRuntimeAuditWriterService(
      audit as unknown as AuditService,
      new RuntimeAuditLogger(audit as unknown as AuditService),
    );
    const schema = { id: 'test-schema' } as ArchitectureSchema;
    const run = {
      id: 'run-1',
      schemaId: 'test-schema',
      context: { parentSessionId: 'parent-session' },
      executionMode: 'session_branches',
      rootSessionId: 'root-session',
      branchSessionIds: { analyst: 'branch-session' },
      status: 'completed',
      prompt: 'Audit this runtime.',
      createdAt: 1,
      updatedAt: 1,
    } as ArchitectureRun;
    const event = {
      id: 'run-1:event:1',
      runId: 'run-1',
      sequence: 1,
      type: 'participant_output',
      message: 'Analyst completed.',
      nodeId: 'analyst',
      roleSlotId: 'analyst',
      createdAt: 1,
    } as ArchitectureExecutionEvent;

    writer.logRun(schema, run, [event], false);

    expect(audit.log).toHaveBeenCalledTimes(1);
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'parent-session',
      type: 'tool_result',
      data: expect.objectContaining({
        kind: 'architecture_runtime',
        eventCount: 1,
      }),
    }));

    writer.logEvent(schema, run, event);

    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'parent-session',
      type: 'architecture_event',
      data: expect.objectContaining({
        architectureRunId: 'run-1',
        eventType: 'participant_output',
        messagePreview: 'Analyst completed.',
      }),
    }));
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({
      type: 'runtime_event',
      label: 'workflow.node.output',
      data: expect.objectContaining({
        domain: 'runtime',
        runId: 'run-1',
      }),
    }));
  });

  it('writes failure and hydration records with the parent session context', () => {
    const audit = {
      log: vi.fn().mockResolvedValue('audit-id'),
    };
    const writer = new ArchitectureRuntimeAuditWriterService(audit as unknown as AuditService);
    const schema = { id: 'test-schema' } as ArchitectureSchema;
    const run = {
      id: 'run-2',
      schemaId: 'test-schema',
      context: { parentSessionId: 'parent-session' },
      executionMode: 'subagent_execution',
      rootSessionId: 'root-session',
      status: 'failed',
      prompt: 'Recover this runtime.',
      createdAt: 1,
      updatedAt: 1,
    } as ArchitectureRun;
    const failure: WorkflowFailure = {
      code: 'UNKNOWN',
      message: 'provider failed',
      retryable: false,
    };
    const hydration: ArchitectureVfsHydrationResult = {
      fromSessionId: 'source-session',
      targetPrefix: 'target',
      requestedPaths: ['README.md'],
      copiedFiles: [{ fromPath: 'README.md', toPath: 'target/README.md', sizeBytes: 8 }],
      skippedPaths: [],
    };

    writer.logFailure(schema, run, failure);
    writer.logHydration(run, hydration);

    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'parent-session',
      type: 'error',
      data: expect.objectContaining({
        kind: 'architecture_error',
        errorCode: 'UNKNOWN',
      }),
    }));
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'parent-session',
      type: 'tool_result',
      label: 'architecture_hydration:run-2',
      data: expect.objectContaining({
        kind: 'architecture_hydration',
        copiedCount: 1,
      }),
    }));
  });
});
