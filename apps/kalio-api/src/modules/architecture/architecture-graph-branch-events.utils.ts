import type { ArchitectureExecutionEvent, ArchitectureRoleSlot, ArchitectureSchemaNode } from '@kalio/types';
import { architectureActionSummaryForEvent } from './architecture-action-summary';

type BranchStreamProjectionOptions = {
  actionSummary?: string;
  nodeId: string;
  roleSlotId: string;
  data: Record<string, unknown>;
};

export type ArchitectureBranchStreamProjection = {
  type: ArchitectureExecutionEvent['type'];
  message: string;
  options: BranchStreamProjectionOptions;
};

export function architectureBranchStreamProjection(input: {
  node: ArchitectureSchemaNode;
  slot: ArchitectureRoleSlot;
  event: string;
  data: unknown;
}): ArchitectureBranchStreamProjection | undefined {
  if (isIgnoredBranchStreamEvent(input.event)) {
    return undefined;
  }
  const payload = isRecord(input.data) ? input.data : {};
  const baseOptions = {
    nodeId: input.node.id,
    roleSlotId: input.slot.id,
    data: branchStreamEventData(input.event, payload),
  };
  if (input.event === 'agent:start') {
    return {
      type: 'agent_started',
      message: `${input.slot.label} child agent started.`,
      options: {
        ...baseOptions,
        actionSummary: architectureActionSummaryForEvent('agent_started', 'role'),
      },
    };
  }
  if (input.event === 'tool:confirmation_required') {
    return {
      type: 'human_gate',
      message: `${input.slot.label} requested HITL approval for ${toolName(payload)}.`,
      options: {
        ...baseOptions,
        actionSummary: 'Waiting for tool confirmation.',
      },
    };
  }
  if (input.event === 'agent:budget_required') {
    const usedIterations = numberField(payload, 'usedIterations');
    const currentLimit = numberField(payload, 'currentLimit');
    const usage = usedIterations !== undefined && currentLimit !== undefined
      ? ` (${usedIterations}/${currentLimit})`
      : '';
    return {
      type: 'human_gate',
      message: `${input.slot.label} requested more tool budget${usage}.`,
      options: {
        ...baseOptions,
        actionSummary: 'Waiting for budget approval.',
      },
    };
  }
  if (input.event === 'tool:start') {
    return {
      type: 'tool_call',
      message: `${input.slot.label} started ${toolName(payload)}.`,
      options: {
        ...baseOptions,
        actionSummary: architectureActionSummaryForEvent('tool_call', 'role'),
      },
    };
  }
  if (input.event === 'tool:result') {
    const status = typeof payload['status'] === 'string' ? payload['status'] : 'unknown';
    return {
      type: 'tool_call',
      message: `${input.slot.label} ${toolName(payload)} ${status}.`,
      options: {
        ...baseOptions,
        actionSummary: architectureActionSummaryForEvent('tool_call', 'role'),
      },
    };
  }
  if (input.event === 'chat:error') {
    return {
      type: 'tool_call',
      message: `${input.slot.label} branch error: ${errorMessageFromPayload(payload)}.`,
      options: {
        ...baseOptions,
        actionSummary: architectureActionSummaryForEvent('tool_call', 'role'),
      },
    };
  }
  return undefined;
}

function isIgnoredBranchStreamEvent(event: string): boolean {
  return event === 'chat:chunk'
    || event === 'chat:complete'
    || event === 'agent:done'
    || event === 'session:created';
}

function branchStreamEventData(event: string, payload: Record<string, unknown>): Record<string, unknown> {
  const args = isRecord(payload['args']) ? payload['args'] : undefined;
  return {
    kind: 'branch_stream',
    event,
    sessionId: stringField(payload, 'sessionId'),
    turnId: stringField(payload, 'turnId'),
    promptMessageId: stringField(payload, 'promptMessageId'),
    callId: stringField(payload, 'callId'),
    requestId: stringField(payload, 'requestId'),
    toolName: stringField(payload, 'toolName'),
    status: stringField(payload, 'status'),
    errorMessage: stringField(payload, 'message') ?? stringField(payload, 'errorMessage'),
    usedIterations: numberField(payload, 'usedIterations'),
    currentLimit: numberField(payload, 'currentLimit'),
    suggestedNextLimit: numberField(payload, 'suggestedNextLimit'),
    requestedBy: stringField(payload, 'requestedBy'),
    toolPath: args ? firstStringField(args, ['path', 'filePath', 'targetPath', 'workdir']) : undefined,
  };
}

function toolName(payload: Record<string, unknown>): string {
  return stringField(payload, 'toolName') ?? 'tool';
}

function errorMessageFromPayload(payload: Record<string, unknown>): string {
  return stringField(payload, 'message') ?? stringField(payload, 'errorMessage') ?? 'unknown error';
}

function stringField(payload: Record<string, unknown>, key: string): string | undefined {
  const value = payload[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function numberField(payload: Record<string, unknown>, key: string): number | undefined {
  const value = payload[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function firstStringField(payload: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
