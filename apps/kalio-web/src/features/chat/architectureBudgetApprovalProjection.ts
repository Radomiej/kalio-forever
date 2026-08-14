import type { AgentBudgetApprovalRequest, ArchitectureExecutionEvent } from '@kalio/types';

export function budgetApprovalFromArchitectureEvent(
  event: ArchitectureExecutionEvent,
  sessionId: string,
): AgentBudgetApprovalRequest | null {
  if (event.type !== 'human_gate' || !isRecord(event.data) || event.data['event'] !== 'agent:budget_required') {
    return null;
  }
  if (event.data['sessionId'] !== sessionId) {
    return null;
  }
  const requestId = stringField(event.data, 'requestId');
  const usedIterations = numberField(event.data, 'usedIterations');
  const currentLimit = numberField(event.data, 'currentLimit');
  if (!requestId || usedIterations === undefined || currentLimit === undefined) {
    return null;
  }
  const suggestedNextLimit = numberField(event.data, 'suggestedNextLimit');
  const nodeId = stringField(event.data, 'nodeId') ?? event.nodeId;
  const roleSlotId = stringField(event.data, 'roleSlotId') ?? event.roleSlotId;
  return {
    requestId,
    sessionId,
    scope: 'agent-flow-branch',
    usedIterations,
    currentLimit,
    ...(suggestedNextLimit !== undefined ? { suggestedNextLimit } : {}),
    ...(stringField(event.data, 'requestedBy') ? { requestedBy: stringField(event.data, 'requestedBy') } : {}),
    ...(nodeId ? { nodeId } : {}),
    ...(roleSlotId ? { roleSlotId } : {}),
  };
}

export function budgetApprovalsFromArchitectureEvents(
  events: ArchitectureExecutionEvent[],
  sessionId: string,
): AgentBudgetApprovalRequest[] {
  return events.flatMap((event) => {
    const approval = budgetApprovalFromArchitectureEvent(event, sessionId);
    return approval ? [approval] : [];
  });
}

export function budgetApprovalsBySessionFromArchitectureEvents(
  events: ArchitectureExecutionEvent[],
): Map<string, AgentBudgetApprovalRequest[]> {
  const bySession = new Map<string, AgentBudgetApprovalRequest[]>();
  for (const event of events) {
    const sessionId = sessionIdFromArchitectureBudgetEvent(event);
    if (!sessionId) {
      continue;
    }
    const approval = budgetApprovalFromArchitectureEvent(event, sessionId);
    if (!approval) {
      continue;
    }
    bySession.set(sessionId, [
      ...(bySession.get(sessionId) ?? []).filter((item) => item.requestId !== approval.requestId),
      approval,
    ]);
  }
  return bySession;
}

function sessionIdFromArchitectureBudgetEvent(event: ArchitectureExecutionEvent): string | null {
  if (event.type !== 'human_gate' || !isRecord(event.data) || event.data['event'] !== 'agent:budget_required') {
    return null;
  }
  return stringField(event.data, 'sessionId') ?? null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function numberField(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
