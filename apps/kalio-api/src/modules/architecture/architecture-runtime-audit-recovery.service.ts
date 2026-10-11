import { Injectable, Optional } from '@nestjs/common';
import type {
  ArchitectureExecutionEvent,
  ArchitectureRun,
  WorkflowReasonCode,
} from '@kalio/types';
import { SessionsService } from '../chat/sessions.service';
import { AuditService, type AuditLogEntry } from '../chat/audit.service';
import { architectureActionFieldsForEvent } from './architecture-action-summary';
import { ArchitectureGoalRepository, type ArchitectureGoalState } from './architecture-goal.repository';
import {
  architectureAuditAutoRoutingData,
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
  reconstructRun(runId: string, sessionId?: string): Promise<ArchitectureRun | null>;
  reconstructEvents(runId: string, sessionId?: string): Promise<ArchitectureExecutionEvent[]>;
}

@Injectable()
export class ArchitectureRuntimeAuditRecoveryService implements ArchitectureRuntimeAuditRecovery {
  constructor(
    private readonly sessions: SessionsService,
    @Optional() private readonly audit?: AuditService,
    @Optional() private readonly goals?: ArchitectureGoalRepository,
  ) {}

  async reconstructRun(runId: string, sessionId?: string): Promise<ArchitectureRun | null> {
    const rows = await this.auditRowsForRun(runId, sessionId);
    return this.reconstructRunFromRows(runId, rows);
  }

  private async reconstructRunFromRows(runId: string, rows: AuditLogEntry[]): Promise<ArchitectureRun | null> {
    if (rows.length === 0) {
      return null;
    }

    const records = rows.map((row) => this.auditData(row));
    // Presence is authoritative even though goal_protocol is not a lifecycle event type.
    const goalMarkers = records.filter(record => record.eventType === 'goal_protocol');
    const summary = records.find((record) => record.kind === 'architecture_runtime');
    const error = records.find((record) => record.kind === 'architecture_error');
    const firstEvent = records.find((record) => record.kind === 'architecture_event');
    const source = summary ?? error ?? firstEvent;
    if (!source) {
      if (goalMarkers.length) throw new Error('GOAL_RECOVERY_MARKER_INVALID');
      return null;
    }

    const schemaId = architectureAuditStringField(source, 'schemaId');
    if (!schemaId) {
      if (goalMarkers.length) throw new Error('GOAL_RECOVERY_MARKER_INVALID');
      return null;
    }

    const events: Array<{
      type: string;
      reasonCode?: WorkflowReasonCode;
      status?: ArchitectureExecutionEvent['status'];
    }> = [];
    for (const record of records) {
      if (record.kind === 'architecture_error') {
        events.push({ type: 'architecture_error', status: 'failed' });
        continue;
      }
      const type = architectureAuditStringField(record, 'eventType');
      if (!type || !isArchitectureExecutionEventType(type)) continue;
      const status = architectureAuditStringField(record, 'status');
      events.push({
        type,
        reasonCode: architectureAuditWorkflowReasonCodeField(record, 'reasonCode')
          ?? architectureAuditWorkflowReasonCodeField(architectureAuditRecordField(record, 'data'), 'reasonCode'),
        ...(status === 'failed' || status === 'blocked' || status === 'cancelled'
          ? { status }
          : {}),
      });
    }
    const status = statusFromArchitectureAuditEventSummary(events);
    const createdAt = Math.min(...rows.map((row) => row.createdAt));
    const updatedAt = Math.max(...rows.map((row) => row.createdAt));
    const executionMode = architectureAuditExecutionMode(source);
    const candidateRootSessionId = architectureAuditStringField(source, 'rootSessionId') ?? rows.find((row) => row.sessionId)?.sessionId ?? undefined;
    const auditedBranchSessionIds = architectureAuditStringRecordField(source, 'branchSessionIds');
    let recoveredOwnership: { rootSessionId?: string; branchSessionIds?: Record<string, string> };
    try {
      recoveredOwnership = auditedBranchSessionIds && Object.keys(auditedBranchSessionIds).length > 0
        ? { rootSessionId: candidateRootSessionId, branchSessionIds: auditedBranchSessionIds }
        : await this.reconstructSessionOwnership(runId, candidateRootSessionId);
    } catch (error) {
      if (goalMarkers.length) throw new Error('GOAL_RECOVERY_OWNERSHIP_INVALID', { cause: error });
      throw error;
    }
    const rootSessionId = recoveredOwnership.rootSessionId ?? candidateRootSessionId;
    const branchSessionIds = recoveredOwnership.branchSessionIds;
    const goalState = goalMarkers.length ? this.recoverGoalState(runId, rootSessionId, schemaId, goalMarkers) : undefined;
    // Generic final artifacts and accepted projections are not durable goal-completion authorization.
    if (goalState && status === 'completed') throw new Error('GOAL_RECOVERY_COMPLETION_UNVERIFIED');

    return {
      id: runId,
      schemaId,
      prompt: goalState ? goalState.packet.original.content
        : architectureAuditPromptFromRecords(records) ?? `Recovered architecture run ${runId}`,
      ...(goalState ? { goalPacket: goalState.packet } : {}),
      executionMode,
      rootSessionId,
      branchSessionIds,
      status,
      createdAt,
      updatedAt,
      completedAt: status === 'running' ? undefined : updatedAt,
    };
  }

  async reconstructEvents(runId: string, sessionId?: string): Promise<ArchitectureExecutionEvent[]> {
    const rows = await this.auditRowsForRun(runId, sessionId);
    if (rows.some(row => this.auditData(row).eventType === 'goal_protocol')) {
      await this.reconstructRunFromRows(runId, rows);
    }
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
        data: architectureAuditAutoRoutingData(data),
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
        data: architectureAuditAutoRoutingData(data),
        createdAt: row.createdAt,
      };
    });
  }

  private recoverGoalState(runId: string, rootSessionId: string | undefined, schemaId: string,
    markers: Record<string, unknown>[]): ArchitectureGoalState {
    if (!rootSessionId) throw new Error('GOAL_RECOVERY_ROOT_MISSING');
    for (const marker of markers) {
      if (marker.schemaVersion !== 1 || marker.runId !== runId || marker.rootSessionId !== rootSessionId
        || marker.schemaId !== schemaId || typeof marker.stateRevision !== 'number'
        || !Number.isSafeInteger(marker.stateRevision) || marker.stateRevision < 1
        || typeof marker.sourceVersion !== 'number' || !Number.isSafeInteger(marker.sourceVersion)
        || marker.sourceVersion < 1) throw new Error('GOAL_RECOVERY_MARKER_INVALID');
    }
    if (!this.goals) throw new Error('GOAL_RECOVERY_STORE_UNAVAILABLE');
    let state: ArchitectureGoalState | null;
    try {
      state = this.goals.load(runId, rootSessionId);
    } catch {
      throw new Error('GOAL_RECOVERY_STATE_INVALID');
    }
    if (!state) throw new Error('GOAL_RECOVERY_STATE_MISSING');
    if (state.runId !== runId || state.rootSessionId !== rootSessionId) throw new Error('GOAL_RECOVERY_STATE_MISMATCH');
    for (const marker of markers) {
      if ((marker.stateRevision as number) > state.stateRevision || (marker.sourceVersion as number) > state.packet.version) {
        throw new Error('GOAL_RECOVERY_MARKER_FUTURE');
      }
    }
    return state;
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

  private async auditRowsForRun(runId: string, sessionId?: string): Promise<AuditLogEntry[]> {
    if (!this.audit) {
      return [];
    }
    if (!runId.trim() || (sessionId !== undefined && !sessionId.trim())) {
      throw new Error('Durable recovery requires a non-empty run/session scope.');
    }
    const rows = await this.audit.listEntries({
      limit: 5000,
      source: 'all',
      runId,
      ...(sessionId !== undefined ? { sessionId } : {}),
    });
    // AuditService has no pagination cursor; never accept a potentially truncated replay.
    if (rows.length >= 5000) throw new Error('Durable audit recovery limit reached; history may be truncated.');
    return rows
      .filter((row) => {
        const data = this.auditData(row);
        const matches = (data.runId === runId || data.architectureRunId === runId)
          && (sessionId === undefined || row.sessionId === sessionId);
        if (matches && data.kind === 'architecture_event') architectureAuditAutoRoutingData(data);
        return matches;
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
