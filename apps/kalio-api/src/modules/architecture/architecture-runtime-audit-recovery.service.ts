import { Injectable, Optional } from '@nestjs/common';
import type {
  ArchitectureExecutionEvent,
  ArchitectureRun,
  WorkflowReasonCode,
} from '@kalio/types';
import { SessionsService } from '../chat/sessions.service';
import { AuditService, type AuditLogEntry } from '../chat/audit.service';
import { architectureActionFieldsForEvent } from './architecture-action-summary';
import {
  architectureAuditEventActionField,
  architectureAuditExecutionMode,
  architectureAuditNumberField,
  architectureAuditPromptFromRecords,
  architectureAuditRecordField,
  architectureAuditRouteDecisionField,
  architectureAuditRouterOutputField,
  architectureAuditStringField,
  architectureAuditStringRecordField,
  architectureAuditWorkflowErrorCodeField,
  architectureAuditWorkflowEvidenceArrayField,
  architectureAuditWorkflowFailureField,
  architectureAuditWorkflowReasonCodeField,
  architectureAuditWorkflowRuntimeDecisionField,
  isArchitectureExecutionEventType,
  statusFromArchitectureAuditEventSummary,
} from './architecture-runtime-audit-recovery.utils';

export interface ArchitectureRuntimeAuditRecovery {
  reconstructRun(runId: string): Promise<ArchitectureRun | null>;
  reconstructEvents(runId: string): Promise<ArchitectureExecutionEvent[]>;
}

@Injectable()
export class ArchitectureRuntimeAuditRecoveryService implements ArchitectureRuntimeAuditRecovery {
  constructor(
    private readonly sessions: SessionsService,
    @Optional() private readonly audit?: AuditService,
  ) {}

  async reconstructRun(runId: string): Promise<ArchitectureRun | null> {
    const rows = await this.auditRowsForRun(runId);
    if (rows.length === 0) {
      return null;
    }

    const records = rows.map((row) => this.auditData(row));
    const summary = records.find((record) => record.kind === 'architecture_runtime');
    const error = records.find((record) => record.kind === 'architecture_error');
    const firstEvent = records.find((record) => record.kind === 'architecture_event');
    const source = summary ?? error ?? firstEvent;
    if (!source) {
      return null;
    }

    const schemaId = architectureAuditStringField(source, 'schemaId');
    if (!schemaId) {
      return null;
    }

    const eventTypes = records
      .map((record) => architectureAuditStringField(record, 'eventType'))
      .filter((type): type is string => Boolean(type));
    const events: Array<{ type: string; reasonCode?: WorkflowReasonCode }> = [];
    for (const record of records) {
      const type = architectureAuditStringField(record, 'eventType');
      if (!type || !isArchitectureExecutionEventType(type)) continue;
      events.push({
        type,
        reasonCode: architectureAuditWorkflowReasonCodeField(record, 'reasonCode')
          ?? architectureAuditWorkflowReasonCodeField(architectureAuditRecordField(record, 'data'), 'reasonCode'),
      });
    }
    const hasFinalArtifact = eventTypes.includes('final_artifact');
    const hasError = Boolean(error);
    const status: ArchitectureRun['status'] = hasError ? 'failed' : hasFinalArtifact ? 'completed' : statusFromArchitectureAuditEventSummary(events);
    const createdAt = Math.min(...rows.map((row) => row.createdAt));
    const updatedAt = Math.max(...rows.map((row) => row.createdAt));
    const executionMode = architectureAuditExecutionMode(source);
    const candidateRootSessionId = architectureAuditStringField(source, 'rootSessionId') ?? rows.find((row) => row.sessionId)?.sessionId ?? undefined;
    const auditedBranchSessionIds = architectureAuditStringRecordField(source, 'branchSessionIds');
    const recoveredOwnership = auditedBranchSessionIds && Object.keys(auditedBranchSessionIds).length > 0
      ? { rootSessionId: candidateRootSessionId, branchSessionIds: auditedBranchSessionIds }
      : await this.reconstructSessionOwnership(runId, candidateRootSessionId);
    const rootSessionId = recoveredOwnership.rootSessionId ?? candidateRootSessionId;
    const branchSessionIds = recoveredOwnership.branchSessionIds;

    return {
      id: runId,
      schemaId,
      prompt: architectureAuditPromptFromRecords(records) ?? `Recovered architecture run ${runId}`,
      executionMode,
      rootSessionId,
      branchSessionIds,
      status,
      createdAt,
      updatedAt,
      completedAt: status === 'running' ? undefined : updatedAt,
    };
  }

  async reconstructEvents(runId: string): Promise<ArchitectureExecutionEvent[]> {
    const rows = await this.auditRowsForRun(runId);
    const eventRows = rows
      .map((row) => ({ row, data: this.auditData(row) }))
      .filter(({ data }) =>
        data.kind === 'architecture_event'
        && isArchitectureExecutionEventType(data.eventType));

    return eventRows.map(({ row, data }, index) => {
      const eventId = architectureAuditStringField(data, 'eventId') ?? `${runId}:audit:${row.id}`;
      const eventType = data.eventType;
      if (!isArchitectureExecutionEventType(eventType)) {
        throw new Error(`Invalid recovered architecture event type for run ${runId}`);
      }
      const route = architectureAuditRouteDecisionField(data, 'route');
      const routerOutput = architectureAuditRouterOutputField(data, 'routerOutput');
      // TODO: legacy fallback - older audit rows only persisted messagePreview/actionSummary, so rebuild action/detail from structured route/routerOutput when needed.
      const actionFields = architectureActionFieldsForEvent({
        type: eventType,
        actionSummary: architectureAuditStringField(data, 'actionSummary'),
        action: architectureAuditEventActionField(data, 'action'),
        detail: architectureAuditStringField(data, 'detail'),
        route,
        routerOutput,
        data,
      });
      return {
        id: eventId,
        runId,
        sequence: architectureAuditNumberField(data, 'sequence') ?? index + 1,
        type: eventType,
        message: architectureAuditStringField(data, 'messagePreview') ?? row.label,
        actionSummary: actionFields.actionSummary,
        action: actionFields.action,
        detail: actionFields.detail,
        nodeId: architectureAuditStringField(data, 'nodeId'),
        roleSlotId: architectureAuditStringField(data, 'roleSlotId'),
        route,
        routerOutput,
        reasonCode: architectureAuditWorkflowReasonCodeField(data, 'reasonCode'),
        errorCode: architectureAuditWorkflowErrorCodeField(data, 'errorCode'),
        failure: architectureAuditWorkflowFailureField(data, 'failure'),
        evidence: architectureAuditWorkflowEvidenceArrayField(data, 'evidence'),
        runtimeDecision: architectureAuditWorkflowRuntimeDecisionField(data, 'runtimeDecision'),
        data,
        createdAt: row.createdAt,
      };
    });
  }

  private async reconstructSessionOwnership(
    runId: string,
    candidateRootSessionId: string | undefined,
  ): Promise<{ rootSessionId?: string; branchSessionIds?: Record<string, string> }> {
    if (!candidateRootSessionId) return {};

    const candidateChildren = await this.sessions.listChildren(candidateRootSessionId);
    const directBranches = this.branchSessionIdsFromSessions(runId, candidateChildren);
    if (directBranches) {
      return { rootSessionId: candidateRootSessionId, branchSessionIds: directBranches };
    }

    const durableRoot = candidateChildren.find((session) =>
      session.runtimeContext?.runtimeKind === 'agent-flow-root'
      && session.runtimeContext.architectureContext?.architectureRunId === runId);
    if (!durableRoot) return { rootSessionId: candidateRootSessionId };

    const branchSessions = await this.sessions.listChildren(durableRoot.id);
    return {
      rootSessionId: durableRoot.id,
      branchSessionIds: this.branchSessionIdsFromSessions(runId, branchSessions),
    };
  }

  private branchSessionIdsFromSessions(
    runId: string,
    sessions: Awaited<ReturnType<SessionsService['listChildren']>>,
  ): Record<string, string> | undefined {
    const pairs = sessions.flatMap((session) => {
      const context = session.runtimeContext;
      const architectureContext = context?.architectureContext;
      if (context?.runtimeKind !== 'agent-flow-branch') return [];
      if (architectureContext?.architectureRunId !== runId) return [];

      const slotId = context.architectureSlotId ?? architectureContext.roleSlotId;
      return slotId ? [[slotId, session.id] as const] : [];
    });

    return pairs.length > 0 ? Object.fromEntries(pairs) : undefined;
  }

  private async auditRowsForRun(runId: string): Promise<AuditLogEntry[]> {
    if (!this.audit) {
      return [];
    }
    const rows = await this.audit.listEntries({
      limit: 5000,
      source: 'all',
    });
    return rows
      .filter((row) => {
        const data = this.auditData(row);
        return data.runId === runId || data.architectureRunId === runId;
      })
      .sort((left, right) => {
        if (left.createdAt !== right.createdAt) {
          return left.createdAt - right.createdAt;
        }
        const leftSequence = architectureAuditNumberField(this.auditData(left), 'sequence') ?? 0;
        const rightSequence = architectureAuditNumberField(this.auditData(right), 'sequence') ?? 0;
        return leftSequence - rightSequence;
      });
  }

  private auditData(row: AuditLogEntry): Record<string, unknown> {
    return row.data && this.isPlainRecord(row.data) ? row.data : {};
  }

  private isPlainRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}
