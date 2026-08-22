import type {
  AgentRunContext,
  ArchitectureRuntimeContext,
  SessionRuntimeContext,
  SocketEvents,
  SubagentCopiedFile,
} from '@kalio/types';
import type { RunSubagentRequest } from '../tool/subagent-runtime.port';
import type { ActiveSubagentRunStatus } from '../tool/subagent-runtime.port';
import type { EmitFn } from './interfaces/stream-context.interface';
import { createWorkflowError, isWorkflowError } from '../../common/utils/workflow-error.util';

export type AgentRunWithDepth = AgentRunContext & { subagentDepth?: number; autoApproveTools?: string[] };
export type ChatErrorCode = SocketEvents['chat:error']['code'];

export interface ActiveSubagentRunInput {
  childSessionId: string;
  parentSessionId: string;
  historySessionId: string;
  vfsSessionId: string;
  turnId: string;
  promptMessageId?: string;
  agentRun?: AgentRunContext;
  controller: AbortController;
}

interface ActiveSubagentRun extends ActiveSubagentRunInput {
  donePromise: Promise<void>;
  resolveDone: () => void;
}

export class ActiveSubagentRunRegistry {
  private readonly active = new Map<string, ActiveSubagentRun>();

  register(input: ActiveSubagentRunInput): () => void {
    let resolveDone!: () => void;
    const donePromise = new Promise<void>((resolve) => {
      resolveDone = resolve;
    });
    const run: ActiveSubagentRun = {
      ...input,
      donePromise,
      resolveDone,
    };
    this.active.set(input.childSessionId, run);
    return () => {
      if (this.active.get(input.childSessionId) === run) {
        this.active.delete(input.childSessionId);
      }
      resolveDone();
    };
  }

  getStatus(sessionId: string): ActiveSubagentRunStatus | null {
    const run = this.active.get(sessionId);
    if (!run) {
      return null;
    }
    return {
      sessionId: run.childSessionId,
      parentSessionId: run.parentSessionId,
      turnId: run.turnId,
      promptMessageId: run.promptMessageId,
      agentRun: run.agentRun,
    };
  }

  async stopAndDrainSessions(sessionIds: readonly string[]): Promise<void> {
    const sessionIdSet = new Set(sessionIds.filter((sessionId) => sessionId.trim().length > 0));
    if (sessionIdSet.size === 0) {
      return;
    }

    const matchedRuns = [...this.active.values()].filter((run) => (
      sessionIdSet.has(run.childSessionId)
      || sessionIdSet.has(run.parentSessionId)
      || sessionIdSet.has(run.historySessionId)
      || sessionIdSet.has(run.vfsSessionId)
    ));
    for (const run of matchedRuns) {
      if (!run.controller.signal.aborted) {
        run.controller.abort(createWorkflowError(
          'UNKNOWN',
          'Sub-agent stopped because its session tree was stopped.',
          { source: 'subagent-runtime', retryable: false },
        ));
      }
    }
    await Promise.all(matchedRuns.map((run) => run.donePromise));
  }
}

export function subagentErrorCode(error: Error): ChatErrorCode {
  if ('code' in error) {
    const code = (error as { code?: unknown }).code;
    if (
      code === 'LLM_RATE_LIMIT'
      || code === 'LLM_TIMEOUT'
      || code === 'LLM_AUTH'
      || code === 'LLM_PROVIDER_DOWN'
      || code === 'LLM_QUOTA'
      || code === 'LLM_BAD_TOOL_ARGS'
      || code === 'LLM_BAD_STRUCTURED_OUTPUT'
      || code === 'MAX_ITERATIONS_REACHED'
    ) {
      return code;
    }
  }
  if (isWorkflowError(error, 'TIMEOUT') || isWorkflowError(error, 'SUBAGENT_TIMEOUT')) {
    return 'LLM_TIMEOUT';
  }
  return 'LLM_ERROR';
}

export function appendCopiedOutputLinks(
  baseText: string,
  parentSessionId: string,
  copiedFiles: SubagentCopiedFile[],
): string {
  if (copiedFiles.length === 0) return baseText;

  const lines = copiedFiles.map((file) => {
    const downloadUrl = `/api/sessions/${parentSessionId}/vfs/download?path=${encodeURIComponent(file.toPath)}`;
    return `- ${file.toPath} -> ${downloadUrl}`;
  });

  return `${baseText}\n\nCopied outputs:\n${lines.join('\n')}`;
}

export function buildAttachmentHint(attachmentPaths: string[]): string {
  if (attachmentPaths.length === 0) return '';
  const lines = attachmentPaths.map((path) => `- ${path}`);
  return `You have attached files available in VFS:\n${lines.join('\n')}\n\n`;
}

export function runtimeContextsEqual(left: SessionRuntimeContext, right: SessionRuntimeContext): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function buildSubagentRuntimeContext(input: {
  runtimeKind: SessionRuntimeContext['runtimeKind'];
  parentSessionId: string;
  parentToolCallId?: string;
  vfsMode: SessionRuntimeContext['vfsMode'];
  vfsSessionId: string;
  modelOverride?: string;
  explicitToolNames: string[];
  systemPromptProfile: SessionRuntimeContext['systemPromptProfile'];
  architectureContext?: ArchitectureRuntimeContext;
  architectureSlotId?: string;
  architectureSlotPolicy: SessionRuntimeContext['architectureSlotPolicy'];
}): SessionRuntimeContext {
  return {
    runtimeKind: input.runtimeKind,
    parentSessionId: input.parentSessionId,
    parentToolCallId: input.parentToolCallId,
    vfsMode: input.vfsMode,
    vfsSessionId: input.vfsSessionId,
    modelOverride: input.modelOverride,
    explicitToolNames: input.explicitToolNames,
    systemPromptProfile: input.systemPromptProfile,
    architectureContext: input.architectureContext,
    architectureSlotId: input.architectureSlotId,
    architectureSlotPolicy: input.architectureSlotPolicy,
  };
}

export function buildSubagentAgentRun(input: {
  taskId: string;
  parentSessionId: string;
  parentToolCallId?: string;
  vfsMode: AgentRunContext['vfsMode'];
  vfsSessionId: string;
  subagentDepth: number;
  autoApproveTools?: string[];
}): AgentRunWithDepth {
  return {
    agentRunId: `subagent-${input.taskId}`,
    agentType: 'subagent',
    parentSessionId: input.parentSessionId,
    parentToolCallId: input.parentToolCallId,
    vfsMode: input.vfsMode,
    vfsSessionId: input.vfsSessionId,
    label: 'Sub-agent',
    autoApproveTools: input.autoApproveTools,
    subagentDepth: input.subagentDepth,
  };
}

export function createSubagentTrackingEmit(input: {
  emit?: EmitFn;
  runtimeKind: SessionRuntimeContext['runtimeKind'];
  childSessionId: string;
  turnId: string;
  promptMessageId?: () => string | undefined;
  onChunk: (delta: string) => void;
}): EmitFn | undefined {
  if (!input.emit) return undefined;
  return (event, data) => {
    if (event === 'chat:chunk') {
      const payload = typeof data === 'object' && data !== null ? data as Record<string, unknown> : {};
      if (typeof payload['delta'] === 'string') input.onChunk(payload['delta']);
    }
    const forwarded = input.runtimeKind === 'agent-flow-branch' && typeof data === 'object' && data !== null
      ? { ...data as Record<string, unknown>, architectureParentExecution: { childSessionId: input.childSessionId, childTurnId: input.turnId, promptMessageId: input.promptMessageId?.() } }
      : data;
    input.emit!(event, forwarded as never);
  };
}

export function architectureContextForSubagent(request: RunSubagentRequest): ArchitectureRuntimeContext | undefined {
  const base = isRecord(request.architectureContext)
    ? request.architectureContext as ArchitectureRuntimeContext
    : undefined;
  if (!isRecord(request.auditContext) || !stringField(request.auditContext, 'architectureRunId')) {
    return base;
  }

  const audit = request.auditContext;
  const roleSlotId = stringField(audit, 'roleSlotId');
  const roleSlotType = stringField(audit, 'roleSlotType');
  const technicalSlot = roleSlotType === 'router'
    || roleSlotType === 'finalizer'
    || roleSlotId === 'router'
    || roleSlotId === 'finalizer'
    || roleSlotId === 'orchestrator';

  return {
    ...(base ?? {}),
    architectureRunId: stringField(audit, 'architectureRunId'),
    schemaId: stringField(audit, 'schemaId') ?? base?.schemaId,
    schemaName: stringField(audit, 'schemaName') ?? base?.schemaName,
    roleSlotId,
    roleSlotType,
    roleLabel: stringField(audit, 'roleLabel'),
    displayLabel: stringField(audit, 'displayLabel') ?? stringField(audit, 'roleLabel') ?? base?.displayLabel,
    sessionSurface: technicalSlot ? 'technical-node' : (base?.sessionSurface ?? 'conversation-branch'),
    conversationVisibility: 'visible',
  };
}

export function resolveHistorySessionId(
  runtimeKind: SessionRuntimeContext['runtimeKind'],
  architectureContext: ArchitectureRuntimeContext | undefined,
  parentSessionId: string,
  childSessionId: string,
): string {
  if (runtimeKind !== 'agent-flow-branch') {
    return childSessionId;
  }
  const historySessionId = architectureContext?.historySessionId;
  if (typeof historySessionId === 'string' && historySessionId.trim().length > 0) {
    return historySessionId.trim();
  }
  const hostSessionId = architectureContext?.hostSessionId;
  if (typeof hostSessionId === 'string' && hostSessionId.trim().length > 0) {
    return hostSessionId.trim();
  }
  return parentSessionId;
}

export function displayTextFromStructuredOutput(output: unknown): string | null {
  if (!output || typeof output !== 'object' || Array.isArray(output)) {
    return null;
  }
  const record = output as Record<string, unknown>;
  for (const key of ['answer', 'response', 'message', 'finalAnswer']) {
    const value = record[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringField(record: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}
