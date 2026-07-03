import type {
  ArchitectureRoleSlot,
  ArchitectureRuntimeContext,
  SessionRuntimeContext,
  WorkflowSessionSurface,
} from '@kalio/types';

type ArchitectureSessionContextArgs = {
  runId: string;
  schemaId: string;
  schemaName: string;
  hostSessionId?: string;
  historySessionId?: string;
};

type ArchitectureRootSessionContextArgs = ArchitectureSessionContextArgs;

type ArchitectureBranchSessionContextArgs = ArchitectureSessionContextArgs & {
  rootSessionId: string;
  slot: ArchitectureRoleSlot;
};

export function getArchitectureParentSessionId(
  context: Record<string, unknown> | undefined,
): string | undefined {
  return stringField(context, 'parentSessionId');
}

export function getArchitectureParentToolCallId(
  context: Record<string, unknown> | undefined,
): string | undefined {
  return stringField(context, 'parentToolCallId');
}

export function getArchitecturePromptMessageId(
  context: Record<string, unknown> | undefined,
): string | undefined {
  return stringField(context, 'promptMessageId');
}

export function getArchitectureHostSessionId(
  context: Record<string, unknown> | undefined,
): string | undefined {
  return stringField(context, 'hostSessionId') ?? getArchitectureParentSessionId(context);
}

export function getArchitectureHistorySessionId(
  context: Record<string, unknown> | undefined,
): string | undefined {
  return stringField(context, 'historySessionId')
    ?? getArchitectureHostSessionId(context)
    ?? getArchitectureParentSessionId(context);
}

export function createArchitectureRootSessionRuntimeContext(
  args: ArchitectureRootSessionContextArgs,
): SessionRuntimeContext {
  return {
    runtimeKind: 'agent-flow-root',
    architectureContext: {
      architectureRunId: args.runId,
      schemaId: args.schemaId,
      schemaName: args.schemaName,
      displayLabel: args.schemaName,
      ...(args.hostSessionId ? { hostSessionId: args.hostSessionId } : {}),
      ...(args.historySessionId ? { historySessionId: args.historySessionId } : {}),
      sessionSurface: 'technical-node',
      conversationVisibility: 'hidden',
    },
  };
}

export function createArchitectureBranchSessionRuntimeContext(
  args: ArchitectureBranchSessionContextArgs,
): SessionRuntimeContext {
  const sessionSurface = sessionSurfaceForSlot(args.slot);
  return {
    runtimeKind: 'agent-flow-branch',
    parentSessionId: args.rootSessionId,
    architectureSlotId: args.slot.id,
    architectureContext: {
      architectureRunId: args.runId,
      schemaId: args.schemaId,
      schemaName: args.schemaName,
      roleSlotId: args.slot.id,
      roleSlotType: args.slot.slotType,
      roleLabel: args.slot.label,
      displayLabel: args.slot.label,
      ...(args.hostSessionId ? { hostSessionId: args.hostSessionId } : {}),
      ...(args.historySessionId ? { historySessionId: args.historySessionId } : {}),
      sessionSurface,
      conversationVisibility: 'visible',
    },
  };
}

function sessionSurfaceForSlot(slot: ArchitectureRoleSlot): WorkflowSessionSurface {
  return slot.slotType === 'participant'
    || slot.slotType === 'critic'
    || slot.slotType === 'tool_executor'
    ? 'conversation-branch'
    : 'technical-node';
}

function stringField(
  context: Record<string, unknown> | undefined,
  key: keyof ArchitectureRuntimeContext,
): string | undefined {
  const value = context?.[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}
