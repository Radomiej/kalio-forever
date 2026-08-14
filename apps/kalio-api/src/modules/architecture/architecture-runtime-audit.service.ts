import { Injectable, Optional } from '@nestjs/common';
import type {
  ArchitectureExecutionEvent,
  ArchitectureRun,
  ArchitectureSchema,
  WorkflowFailure,
} from '@kalio/types';
import { AuditService } from '../chat/audit.service';
import { RuntimeAuditLogger } from '../chat/runtime-audit-logger.service';
import type { ArchitectureVfsHydrationResult } from './architecture-vfs-hydration';
import { architectureActionFieldsForEvent } from './architecture-action-summary';
import {
  architectureFailureRuntimeAuditEventInput,
  architectureRuntimeAuditEventInput,
} from './architecture-runtime-audit';
import {
  getArchitectureParentSessionId,
} from './architecture-session-context';

export interface ArchitectureRuntimeAuditWriter {
  logRun(
    schema: ArchitectureSchema,
    run: ArchitectureRun,
    events: ArchitectureExecutionEvent[],
    auditEvents?: boolean,
  ): void;
  logEvent(schema: ArchitectureSchema, run: ArchitectureRun, event: ArchitectureExecutionEvent): void;
  logFailure(schema: ArchitectureSchema, run: ArchitectureRun, failure: WorkflowFailure): void;
  logHydration(run: ArchitectureRun, hydration: ArchitectureVfsHydrationResult | null): void;
}

@Injectable()
export class ArchitectureRuntimeAuditWriterService implements ArchitectureRuntimeAuditWriter {
  constructor(
    @Optional() private readonly audit?: AuditService,
    @Optional() private readonly runtimeAudit?: RuntimeAuditLogger,
  ) {}

  logRun(
    schema: ArchitectureSchema,
    run: ArchitectureRun,
    events: ArchitectureExecutionEvent[],
    auditEvents = true,
  ): void {
    if (!this.audit) return;
    const sessionId = getArchitectureParentSessionId(run.context) ?? run.rootSessionId;
    void this.audit.log({
      sessionId,
      type: 'tool_result',
      label: `architecture:${schema.id}:${run.id}`,
      data: {
        domain: 'architecture',
        kind: 'architecture_runtime',
        runId: run.id,
        schemaId: schema.id,
        executionMode: run.executionMode,
        rootSessionId: run.rootSessionId,
        branchSessionIds: run.branchSessionIds,
        eventCount: events.length,
        events: events.map((event) => ({
          id: event.id,
          type: event.type,
          nodeId: event.nodeId,
          roleSlotId: event.roleSlotId,
          route: event.route,
        })),
      },
    });
    if (!auditEvents) return;
    events.forEach((event) => this.logEvent(schema, run, event));
  }

  logEvent(
    schema: ArchitectureSchema,
    run: ArchitectureRun,
    event: ArchitectureExecutionEvent,
  ): void {
    const sessionId = getArchitectureParentSessionId(run.context) ?? run.rootSessionId ?? run.id;
    if (this.audit) {
      const actionFields = architectureActionFieldsForEvent(event);
      void this.audit.log({
        sessionId,
        type: 'architecture_event',
        label: `architecture_event:${event.type}:${event.nodeId ?? 'runtime'}`,
        data: {
          domain: 'architecture',
          kind: 'architecture_event',
          runId: run.id,
          architectureRunId: run.id,
          schemaId: schema.id,
          executionMode: run.executionMode,
          rootSessionId: run.rootSessionId,
          eventId: event.id,
          eventType: event.type,
          sequence: event.sequence,
          nodeId: event.nodeId,
          roleSlotId: event.roleSlotId,
          prompt: event.type === 'run_created' ? run.prompt : undefined,
          reasonCode: event.reasonCode,
          errorCode: event.errorCode,
          failure: event.failure,
          evidence: event.evidence,
          runtimeDecision: event.runtimeDecision,
          incompleteReason: typeof event.data?.['incompleteReason'] === 'string' ? event.data['incompleteReason'] : undefined,
          runtimeGuard: typeof event.data?.['runtimeGuard'] === 'string' ? event.data['runtimeGuard'] : undefined,
          toolEvidence: this.toolEvidenceForAudit(event),
          route: event.route,
          routerOutput: event.routerOutput,
          messagePreview: event.message.slice(0, 800),
          actionSummary: actionFields.actionSummary,
          action: actionFields.action,
          detail: actionFields.detail,
        },
      });
    }
    const runtimeEvent = architectureRuntimeAuditEventInput(schema, run, event, sessionId);
    if (runtimeEvent) {
      void this.runtimeAudit?.log(runtimeEvent);
    }
  }

  logFailure(
    schema: ArchitectureSchema,
    run: ArchitectureRun,
    failure: WorkflowFailure,
  ): void {
    if (!this.audit) return;
    void this.audit.log({
      sessionId: getArchitectureParentSessionId(run.context) ?? run.rootSessionId,
      type: 'error',
      label: `architecture:error:${schema.id}:${run.id}`,
      data: {
        domain: 'architecture',
        kind: 'architecture_error',
        runId: run.id,
        architectureRunId: run.id,
        schemaId: schema.id,
        executionMode: run.executionMode,
        rootSessionId: run.rootSessionId,
        branchSessionIds: run.branchSessionIds,
        status: run.status,
        errorCode: failure.code,
        failure,
        errorMessage: failure.message,
      },
    });
    const sessionId = getArchitectureParentSessionId(run.context) ?? run.rootSessionId ?? run.id;
    void this.runtimeAudit?.log(architectureFailureRuntimeAuditEventInput(schema, run, failure, sessionId));
  }

  logHydration(
    run: ArchitectureRun,
    hydration: ArchitectureVfsHydrationResult | null,
  ): void {
    if (!this.audit || !hydration) return;
    void this.audit.log({
      sessionId: getArchitectureParentSessionId(run.context) ?? run.rootSessionId,
      type: 'tool_result',
      label: `architecture_hydration:${run.id}`,
      data: {
        domain: 'architecture',
        kind: 'architecture_hydration',
        runId: run.id,
        architectureRunId: run.id,
        rootSessionId: run.rootSessionId,
        fromSessionId: hydration.fromSessionId,
        targetPrefix: hydration.targetPrefix,
        requestedPaths: hydration.requestedPaths,
        copiedFiles: hydration.copiedFiles,
        copiedCount: hydration.copiedFiles.length,
        skippedPaths: hydration.skippedPaths,
        skippedCount: hydration.skippedPaths.length,
      },
    });
  }

  private toolEvidenceForAudit(event: ArchitectureExecutionEvent): Record<string, unknown> | undefined {
    const value = event.data?.['toolEvidence'];
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
  }
}
