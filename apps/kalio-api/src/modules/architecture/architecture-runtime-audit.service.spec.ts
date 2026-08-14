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
